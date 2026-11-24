use std::time::Duration;

use semver::Version;
use serde::Deserialize;
use tauri::{App, AppHandle, Manager, Url};
use tauri_plugin_updater::UpdaterExt;

use crate::flag_preference;

const EXPERIMENTAL: &str = "experimental-updates";
const TIMEOUT: Duration = Duration::from_secs(15);
const REPOSITORY: &str = match option_env!("ORGANIFY_RELEASE_REPOSITORY") {
    Some(repo) => repo,
    None => "marcoscr-ue/Organify",
};

#[derive(Default)]
struct UpdateCheck(tauri::async_runtime::Mutex<bool>);

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    draft: bool,
    prerelease: bool,
    assets: Vec<Asset>,
}

#[derive(Deserialize)]
struct Asset {
    name: String,
}

impl Release {
    fn candidate(self, current: &Version) -> Option<(Version, String)> {
        if self.draft || !self.prerelease || !self.assets.iter().any(|a| a.name == "latest.json") {
            return None;
        }
        let tag = self.tag_name;
        let version = Version::parse(tag.strip_prefix('v').unwrap_or(&tag)).ok()?;
        version
            .cmp_precedence(current)
            .is_gt()
            .then_some((version, tag))
    }
}

fn updater_available(app: &AppHandle) -> bool {
    !cfg!(debug_assertions) && app.config().plugins.0.contains_key("updater")
}

#[tauri::command]
pub(crate) fn experimental_updates(
    app: AppHandle,
    enabled: Option<bool>,
) -> Result<Option<bool>, String> {
    if !updater_available(&app) {
        return Ok(None);
    }
    flag_preference(&app, EXPERIMENTAL, enabled).map(Some)
}

async fn latest_prerelease(current: &Version) -> Result<Option<(Version, Url)>, String> {
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    let client = reqwest::Client::builder()
        .user_agent("Organify")
        .timeout(TIMEOUT)
        .build()
        .map_err(|error| error.to_string())?;
    let releases_url = format!("https://api.github.com/repos/{REPOSITORY}/releases");
    let mut latest = None;
    for page in 1.. {
        let response = client
            .get(format!("{releases_url}?per_page=100&page={page}"))
            .header("Accept", "application/vnd.github+json")
            .send()
            .await
            .and_then(reqwest::Response::error_for_status)
            .map_err(|error| error.to_string())?;
        let has_next_page = response
            .headers()
            .get(reqwest::header::LINK)
            .and_then(|header| header.to_str().ok())
            .is_some_and(|links| links.contains("rel=\"next\""));
        let releases: Vec<Release> = response.json().await.map_err(|error| error.to_string())?;

        latest = releases
            .into_iter()
            .filter_map(|release| release.candidate(current))
            .chain(latest)
            .max_by(|(a, _), (b, _)| a.cmp_precedence(b));
        if !has_next_page {
            break;
        }
    }
    latest
        .map(|(version, tag)| {
            Url::parse(&format!(
                "https://github.com/{REPOSITORY}/releases/download/{tag}/latest.json"
            ))
            .map(|url| (version, url))
            .map_err(|error| error.to_string())
        })
        .transpose()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selects_the_highest_published_prerelease_with_an_updater_manifest() {
        let current = Version::parse("0.14.0").unwrap();
        let releases = [
            ("v0.15.0-beta.2", false, true, true),
            ("v0.15.0-beta.10", false, true, true),
            ("v0.16.0-beta.1", true, true, true),
            ("v0.17.0-beta.1", false, true, false),
            ("v0.18.0", false, false, true),
            ("v0.14.1", false, true, true),
            ("v0.14.0-beta.9", false, true, true),
        ];
        let latest = releases
            .into_iter()
            .filter_map(|(tag, draft, prerelease, has_manifest)| {
                Release {
                    tag_name: tag.into(),
                    draft,
                    prerelease,
                    assets: if has_manifest {
                        vec![Asset {
                            name: "latest.json".into(),
                        }]
                    } else {
                        vec![]
                    },
                }
                .candidate(&current)
            })
            .max_by(|(a, _), (b, _)| a.cmp_precedence(b));
        assert_eq!(latest.unwrap().1, "v0.15.0-beta.10");
    }
}

async fn install(app: &AppHandle, experimental: bool) -> Result<bool, String> {
    let mut builder = app.updater_builder().timeout(TIMEOUT);
    if experimental {
        let Some((version, endpoint)) = latest_prerelease(&app.package_info().version).await?
        else {
            return Ok(false);
        };
        builder = builder
            .endpoints(vec![endpoint])
            .map_err(|error| error.to_string())?
            .version_comparator(move |current, release| {
                release.version == version && version.cmp_precedence(&current).is_gt()
            });
    } else {
        builder = builder.version_comparator(|current, release| {
            release.version.pre.is_empty() && release.version.cmp_precedence(&current).is_gt()
        });
    }
    let updater = builder.build().map_err(|error| error.to_string())?;
    let Some(update) = updater.check().await.map_err(|error| error.to_string())? else {
        return Ok(false);
    };
    if experimental && !flag_preference(app, EXPERIMENTAL, None)? {
        return Ok(false);
    }
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|error| error.to_string())?;
    Ok(true)
}

#[tauri::command]
pub(crate) async fn check_experimental_update(app: AppHandle) -> Result<bool, String> {
    if !updater_available(&app) {
        return Ok(false);
    }
    let state = app.state::<UpdateCheck>();
    let mut installed = state.0.lock().await;
    if !*installed && flag_preference(&app, EXPERIMENTAL, None)? {
        *installed = install(&app, true).await?;
    }
    Ok(*installed)
}

pub(crate) fn setup(app: &App) -> tauri::Result<()> {
    let handle = app.handle().clone();
    if !updater_available(&handle) {
        return Ok(());
    }
    handle.plugin(tauri_plugin_updater::Builder::new().build())?;
    app.manage(UpdateCheck::default());
    tauri::async_runtime::spawn(async move {
        let state = handle.state::<UpdateCheck>();
        let mut installed = state.0.lock().await;
        if *installed {
            return;
        }
        if flag_preference(&handle, EXPERIMENTAL, None).unwrap_or_default() {
            match install(&handle, true).await {
                Ok(true) => {
                    *installed = true;
                    return;
                }
                Ok(false) => {}
                Err(error) => eprintln!("No se pudo consultar el canal experimental: {error}"),
            }
        }
        match install(&handle, false).await {
            Ok(updated) => *installed = updated,
            Err(error) => eprintln!("No se pudo actualizar Organify: {error}"),
        }
    });
    Ok(())
}
