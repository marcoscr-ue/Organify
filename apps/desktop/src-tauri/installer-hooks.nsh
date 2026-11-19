!macro NSIS_HOOK_POSTINSTALL
  Push $R0
  ${If} $UpdateMode = 1
    CreateDirectory "$LOCALAPPDATA\${BUNDLEID}"
    ClearErrors
    FileOpen $R0 "$LOCALAPPDATA\${BUNDLEID}\pending-release-notes" w
    ${IfNot} ${Errors}
      FileWrite $R0 "${VERSION}"
      FileClose $R0
    ${EndIf}
  ${Else}
    Delete "$LOCALAPPDATA\${BUNDLEID}\pending-release-notes"
  ${EndIf}
  ClearErrors
  Pop $R0
!macroend
