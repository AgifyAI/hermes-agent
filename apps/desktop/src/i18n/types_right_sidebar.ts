// The right sidebar's copy (file tree, folder picker, terminals); `Translations.rightSidebar`.
export interface RightSidebarTranslations {
  automationsTitle: string
  goalTitle: string
  goalEmpty: string
  goalProgressTokens: (used: string, budget: string) => string
  goalProgressRounds: (started: number | string, max: number | string) => string
  goalTime: (seconds: number) => string
  goalWaitingOn: (cause: string) => string
  goalWaitingOnSeconds: (cause: string, seconds: number) => string
  goalResumeNow: string
  goalReason: (reason: string) => string
  goalCriterionRemove: string
  goalCriterionPlaceholder: string
  goalCriterionAdd: string
  goalPause: string
  goalResume: string
  goalClear: string
  goalAddCriterion: string
  goalClearConfirmTitle: string
  goalClearConfirmBody: string
  goalClearConfirm: string
  goalContinuationFailed: string
  goalActionDone: string
  goalActionFailed: string
  goalPhaseActive: string
  goalPhasePaused: string
  goalPhaseBlocked: string
  goalPhaseBudgetLimited: string
  goalPhaseComplete: string
  goalOpenPanel: string
  goalEdit: string
  goalSetGoal: string
  goalFormObjective: string
  goalFormObjectivePlaceholder: string
  goalFormContractTitle: string
  goalFormOutcome: string
  goalFormVerification: string
  goalFormConstraints: string
  goalFormBoundaries: string
  goalFormStopWhen: string
  goalFormSave: string
  goalFormCancel: string
  goalFormObjectiveRequired: string
  goalConfirmRewriteTitle: string
  goalConfirmRewriteBody: string
  goalConfirmRewrite: string
  goalConfirmNewTitle: string
  goalConfirmNewBody: string
  goalConfirmNew: string
  goalGatesTitle: string
  goalGatesEmpty: string
  goalGateAdd: string
  goalGateAddSave: string
  goalGateCommand: string
  goalGateCommandPlaceholder: string
  goalGateTimeout: string
  goalGateTimeoutPlaceholder: string
  goalGateRetries: string
  goalGateRetriesPlaceholder: string
  goalGateMeta: (attempts: number, maxRetries: number, timeoutSeconds: number) => string
  goalGateRemove: string
  goalGateCommandRequired: string
  goalGateTimeoutInvalid: string
  goalGateRetriesInvalid: string
  goalGateConfirmTitle: string
  goalGateConfirmBody: (command: string) => string
  goalGateConfirm: string
  goalGateRemoveConfirmTitle: string
  goalGateRemoveConfirmBody: (command: string) => string
  goalGateRemoveConfirm: string
  goalWaitAdd: string
  goalWaitMode: string
  goalWaitModeSeconds: string
  goalWaitModePid: string
  goalWaitModeSession: string
  goalWaitValue: string
  goalWaitReason: string
  goalWaitReasonPlaceholder: string
  goalWaitSave: string
  goalWaitCancel: string
  goalWaitValueRequired: string
  goalWaitSecondsInvalid: string
  goalWaitPidInvalid: string
  pendingMemoryTitle: string
  pendingMemoryTextAria: string
  pendingMemoryLoading: string
  pendingMemoryEmpty: string
  pendingMemoryLoadFailed: string
  pendingMemoryRequestFailed: string
  pendingMemoryCurrent: string
  pendingMemoryProposed: string
  pendingMemoryCancel: string
  pendingMemorySave: string
  pendingMemoryEdit: string
  pendingMemoryReject: string
  pendingMemoryApprove: string
  queuedMessagesTitle: string
  queuedMessagesEmpty: string
  scratchpadTitle: string
  scratchpadPlaceholder: string
  scratchpadEmptySession: string
  scratchpadSaving: string
  scratchpadError: string
  aria: string
  panelsAria: string
  files: string
  terminal: string
  noFolderSelected: string
  changeCwdTitle: string
  remotePickerTitle: string
  remotePickerDescription: string
  remotePickerSelect: string
  remotePickerNewFolder: string
  remotePickerFolderName: string
  remotePickerCreateFolder: string
  remotePickerInvalidFolderName: string
  remotePickerCreateFolderFailed: (error: string) => string
  folderTip: (cwd: string) => string
  openFolder: string
  refreshTree: string
  collapseAll: string
  showIgnored: string
  hideIgnored: string
  previewUnavailable: string
  couldNotPreview: (path: string) => string
  noProjectTitle: string
  noProjectBody: string
  noProjectOpen: string
  noDiffs: string
  unreadableTitle: string
  unreadableBody: (error: string) => string
  emptyTitle: string
  emptyBody: string
  treeErrorTitle: string
  treeErrorBody: string
  tryAgain: string
  loadingTree: string
  loadingFiles: string
  terminalHide: string
  terminalsAria: string
  terminalNew: string
  terminalReadOnly: string
  terminalReadOnlyHelp: string
  terminalOpenInteractive: string
  terminalCloseOthers: string
  terminalCloseAll: string
  terminalDropUploadFailed: (name: string) => string
  terminalDropTooLargeTitle: string
  terminalDropTooLarge: (names: string, limit: string) => string
  terminalDropControlTitle: string
  terminalDropControl: (paths: string) => string
  terminalDropUnquotable: (shell: string, paths: string) => string
  addToChat: string
}
