import {
  createOpCodec,
  createWorkspaceSecret,
  decodeWorkspaceSecret,
  encodeWorkspaceSecret,
  openWorkspaceValue,
  sealWorkspaceValue,
  workspaceInvitationProof,
  type Box,
} from "@organify/crypto";
import { createTaskRepositories } from "@organify/storage";
import { createSyncClient, SyncEngine, workspaceAdapter } from "@organify/sync";

export interface WorkspaceSession {
  api: ReturnType<typeof createSyncClient>;
  userId: string;
  key: Uint8Array;
}

interface WorkspaceRow {
  id: string;
  membership_id: string;
  is_owner: boolean;
  encrypted_name: Box;
  key_box: Box;
}

export interface SharedWorkspace {
  id: string;
  membershipId: string;
  owner: boolean;
  name: string;
  key: Uint8Array;
}

function memberPurpose(userId: string) {
  return "member:" + userId;
}

export async function listWorkspaces({ api, key, userId }: WorkspaceSession) {
  const { data, error } = await api.rpc("organify_workspace_list");
  if (error) throw error;
  return Promise.all(
    (data as WorkspaceRow[]).map(async (row): Promise<SharedWorkspace> => {
      const workspaceKey = await openWorkspaceValue(
        row.key_box,
        key,
        row.id,
        memberPurpose(userId),
      );
      const name = new TextDecoder().decode(
        await openWorkspaceValue(
          row.encrypted_name,
          workspaceKey,
          row.id,
          "name",
        ),
      );
      return {
        id: row.id,
        membershipId: row.membership_id,
        owner: row.is_owner,
        name,
        key: workspaceKey,
      };
    }),
  );
}

export async function createWorkspace(
  { api, key, userId }: WorkspaceSession,
  name: string,
) {
  const space = crypto.randomUUID();
  const workspaceKey = await createWorkspaceSecret();
  const [name_box, own_key_box] = await Promise.all([
    sealWorkspaceValue(name, workspaceKey, space, "name"),
    sealWorkspaceValue(workspaceKey, key, space, memberPurpose(userId)),
  ]);
  const { error } = await api.rpc("organify_workspace_create", {
    space,
    expected_user: userId,
    name_box,
    own_key_box,
  });
  if (error) throw error;
  return space;
}

export async function inviteToWorkspace(
  { api }: WorkspaceSession,
  workspace: SharedWorkspace,
  email: string,
) {
  const invite = crypto.randomUUID();
  const secret = await createWorkspaceSecret();
  const [invite_proof, invite_box, encoded] = await Promise.all([
    workspaceInvitationProof(secret),
    sealWorkspaceValue(workspace.key, secret, workspace.id, "invite:" + invite),
    encodeWorkspaceSecret(secret),
  ]);
  const { error } = await api.rpc("organify_workspace_invite", {
    space: workspace.id,
    invite,
    email,
    invite_proof,
    invite_box,
  });
  if (error) throw error;
  return `organify-v1.${invite}.${encoded}`;
}

export async function acceptWorkspace(
  { api, key, userId }: WorkspaceSession,
  code: string,
) {
  const match =
    /^organify-v1\.([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\.([a-f0-9]{64})$/.exec(
      code.trim(),
    );
  if (!match) throw new Error("Introduce un código de invitación válido.");
  const [, invite, encoded] = match;
  const secret = await decodeWorkspaceSecret(encoded);
  const invite_proof = await workspaceInvitationProof(secret);
  const { data, error } = await api
    .rpc("organify_workspace_read_invite", {
      invite,
      invite_proof,
    })
    .maybeSingle<{ workspace_id: string; key_box: Box }>();
  if (error) throw error;
  if (!data)
    throw new Error(
      "La invitación ha caducado, ya se ha usado o pertenece a otra cuenta.",
    );
  const { workspace_id: space } = data;
  const workspaceKey = await openWorkspaceValue(
    data.key_box,
    secret,
    space,
    "invite:" + invite,
  );
  const own_key_box = await sealWorkspaceValue(
    workspaceKey,
    key,
    space,
    memberPurpose(userId),
  );
  const result = await api.rpc("organify_workspace_accept", {
    space,
    invite,
    invite_proof,
    expected_user: userId,
    own_key_box,
  });
  if (result.error) throw result.error;
  return space;
}

export interface WorkspaceMember {
  membership_id: string;
  email: string;
}

export async function listWorkspaceMembers(
  { api }: WorkspaceSession,
  space: string,
) {
  const { data, error } = await api.rpc("organify_workspace_members_list", {
    space,
  });
  if (error) throw error;
  return data as WorkspaceMember[];
}

export async function removeWorkspaceMember(
  { api }: WorkspaceSession,
  space: string,
  membership: string,
) {
  const { error } = await api.rpc("organify_workspace_remove_member", {
    space,
    membership,
  });
  if (error) throw error;
}

export function connectWorkspace(
  { api }: WorkspaceSession,
  space: SharedWorkspace,
) {
  // A new membership gets its own queue, even after rejoining the same space.
  const repositories = createTaskRepositories(
    "organify-shared-" + space.membershipId,
    space.id,
  );
  const engine = new SyncEngine(
    repositories.sync,
    workspaceAdapter(api, space.id, space.membershipId),
    createOpCodec("workspace:" + space.id, space.key),
  );
  return { ...space, repositories, engine };
}

export type ConnectedWorkspace = ReturnType<typeof connectWorkspace>;
