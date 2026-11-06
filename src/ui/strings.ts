export interface Strings {
  readonly button: string
  readonly buttonTitle: string
  readonly heading: string
  readonly scopeLabel: string
  readonly scopeTurn: string
  readonly scopeLastN: string
  readonly scopeAll: string
  readonly turnsLabel: string
  readonly exportSelection: string
  readonly capture: string
  readonly export: string
  readonly exportAll: string
  readonly defaultDirLabel: string
  readonly defaultDirUnset: string
  readonly dirPlaceholder: string
  readonly dirSave: string
  readonly dirClearLabel: string
  readonly formatLabel: string
  readonly formatBibtex: string
  readonly formatRis: string
  readonly batchHeading: string
  readonly batchEmpty: string
  readonly refresh: string
  readonly selectedCount: string
  readonly authorConjunction: string
  readonly manualOpen: string
  readonly manualSave: string
  readonly fieldFirstAuthor: string
  /** Tooltip on the mark that says the model annotated this entry. */
  readonly annotated: string
  /** Move a quarantined entry into the library after a fresh check. */
  readonly promoteVerify: string
  /** Move a quarantined entry in as manually accepted, no registry check. */
  readonly promoteManual: string
  readonly statusSaved: string
  readonly statusQuarantined: string
  readonly statusSkipped: string
  readonly statusFailed: string
  readonly close: string
  readonly unavailable: string
  readonly detailsSave: string
  readonly detailsSaved: string
  readonly detailsStale: string
  readonly detailsReset: string
  readonly fieldType: string
  readonly fieldTitle: string
  readonly fieldAuthors: string
  readonly fieldAuthorsHint: string
  readonly fieldContainer: string
  readonly fieldYear: string
  readonly fieldVolume: string
  readonly fieldIssue: string
  readonly fieldPages: string
  readonly fieldPublisher: string
  readonly fieldPlace: string
  readonly fieldLanguage: string
  readonly fieldDoi: string
  readonly fieldArxiv: string
  readonly fieldUrl: string
}

export const EN: Strings = {
  button: 'Refs',
  buttonTitle: 'Capture references from this conversation',
  heading: 'Capture references',
  scopeLabel: 'Scope',
  scopeTurn: 'This turn',
  scopeLastN: 'Last N turns',
  scopeAll: 'Whole conversation',
  turnsLabel: 'Turns',
  exportSelection: 'Tick the references to export.',
  capture: 'Capture & save',
  export: 'Export this capture',
  exportAll: 'Export all references',
  defaultDirLabel: 'Folder',
  defaultDirUnset: 'not set (refs/exports/)',
  dirPlaceholder: 'Paste a folder path…',
  dirSave: 'Save folder',
  dirClearLabel: 'Clear',
  formatLabel: 'Formats',
  formatBibtex: 'BibTeX',
  formatRis: 'RIS',
  batchHeading: 'Last capture',
  batchEmpty: 'Nothing captured yet — the export buttons then fall back to the whole library.',
  refresh: 'Refresh list',
  selectedCount: '{n} selected for export',
  authorConjunction: 'and',
  manualOpen: 'Enter manually',
  manualSave: 'Save manually',
  fieldFirstAuthor: 'First author',
  annotated: 'annotated',
  promoteVerify: 'Re-verify',
  promoteManual: 'Store as manual',
  statusSaved: 'saved',
  statusQuarantined: '⚠ quarantined',
  statusSkipped: 'skipped',
  statusFailed: 'failed',
  close: 'Close',
  unavailable: 'The composer is not ready yet; reopen the panel and retry.',
  detailsSave: 'Save changes',
  detailsSaved: 'Saved. Exports now use these fields.',
  detailsStale:
    'This entry was captured before field snapshots existed, so only its title, year and id are known. Capture again to pull the full record from the registries.',
  detailsReset: 'Revert',
  fieldType: 'Type',
  fieldTitle: 'Title',
  fieldAuthors: 'Authors (one per line)',
  fieldAuthorsHint: 'Family, Given',
  fieldContainer: 'Publication',
  fieldYear: 'Year',
  fieldVolume: 'Volume',
  fieldIssue: 'Issue',
  fieldPages: 'Pages',
  fieldPublisher: 'Publisher',
  fieldPlace: 'Place',
  fieldLanguage: 'Language',
  fieldDoi: 'DOI',
  fieldArxiv: 'arXiv ID',
  fieldUrl: 'URL',
}

export const ZH: Strings = {
  button: '引用',
  buttonTitle: '从当前对话中捕获文献',
  heading: '捕获文献',
  scopeLabel: '范围',
  scopeTurn: '本轮',
  scopeLastN: '前 N 轮',
  scopeAll: '全部对话',
  turnsLabel: '轮数',
  exportSelection: '勾选需要导出的文献',
  capture: '捕获并保存',
  export: '导出本次捕获',
  exportAll: '导出全部文献',
  defaultDirLabel: '文件夹',
  defaultDirUnset: '未设置（refs/exports/）',
  dirPlaceholder: '粘贴文件夹路径…',
  dirSave: '保存文件夹',
  dirClearLabel: '清除',
  formatLabel: '导出格式',
  formatBibtex: 'BibTeX',
  formatRis: 'RIS',
  batchHeading: '最近一次捕获',
  batchEmpty: '还没有捕获记录；此时导出会退回整库。',
  refresh: '刷新列表',
  selectedCount: '已选择 {n} 条待导出',
  authorConjunction: '和',
  manualOpen: '手动入表',
  manualSave: '保存并入表',
  fieldFirstAuthor: '首作者',
  annotated: '已注解',
  promoteVerify: '重新核验',
  promoteManual: '人工确认入表',
  statusSaved: '已入表',
  statusQuarantined: '⚠ 隔离',
  statusSkipped: '跳过',
  statusFailed: '失败',
  close: '关闭',
  unavailable: '输入框尚未就绪，请重新打开面板再试。',
  detailsSave: '保存修改',
  detailsSaved: '已保存，导出将使用修改后的字段。',
  detailsStale:
    '这条是较早捕获留下的，只存了标题、年份和标识，没有完整字段。重新捕获一次即可从 Crossref / OpenAlex 补全。',
  detailsReset: '还原',
  fieldType: '条目类型',
  fieldTitle: '标题',
  fieldAuthors: '作者（每行一个）',
  fieldAuthorsHint: '“姓, 名”',
  fieldContainer: '出版物',
  fieldYear: '年份',
  fieldVolume: '卷',
  fieldIssue: '期',
  fieldPages: '页码',
  fieldPublisher: '出版社',
  fieldPlace: '出版地',
  fieldLanguage: '语言',
  fieldDoi: 'DOI',
  fieldArxiv: 'arXiv ID',
  fieldUrl: 'URL',
}

/** Pick a dictionary for one BCP 47 tag, defaulting to English. */
export function stringsFor(tag: string | undefined): Strings {
  return tag !== undefined && tag.toLowerCase().startsWith('zh') ? ZH : EN
}
