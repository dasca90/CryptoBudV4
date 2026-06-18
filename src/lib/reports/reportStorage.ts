import type { BotReport } from './botReportGenerator';
import { botReportToJson, botReportToMarkdown } from './botReportGenerator';

export interface SavedBotReport {
  id: string;
  name: string;
  savedAt: string;
  windowHours: BotReport['windowHours'];
  generatedAt: string;
  report: BotReport;
}

export interface ReportSaveResult {
  saved: SavedBotReport;
  fileSaved: boolean;
  folderName: string | null;
  fallbackReason: string | null;
}

const STORAGE_KEY = 'cryptobud_v4:saved_bot_reports';
const MAX_SAVED_REPORTS = 100;

let selectedDirectoryHandle: FileSystemDirectoryHandle | null = null;

function canUseLocalStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'report';
}

export function getSelectedReportFolderName(): string | null {
  return selectedDirectoryHandle?.name ?? null;
}

export function loadSavedBotReports(): SavedBotReport[] {
  if (!canUseLocalStorage()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is SavedBotReport => {
      return Boolean(item?.id && item?.report && item?.savedAt && item?.generatedAt);
    });
  } catch {
    return [];
  }
}

export function persistSavedBotReports(reports: SavedBotReport[]): void {
  if (!canUseLocalStorage()) return;
  const trimmed = reports
    .slice()
    .sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt))
    .slice(0, MAX_SAVED_REPORTS);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
}

export function deleteSavedBotReport(id: string): SavedBotReport[] {
  const next = loadSavedBotReports().filter((report) => report.id !== id);
  persistSavedBotReports(next);
  return next;
}

export async function chooseReportFolder(): Promise<string | null> {
  const picker = (globalThis as unknown as {
    showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
  }).showDirectoryPicker;
  if (!picker) return null;
  selectedDirectoryHandle = await picker({ mode: 'readwrite' });
  return selectedDirectoryHandle.name;
}

export async function openReportJsonFile(): Promise<BotReport | null> {
  const picker = (globalThis as unknown as {
    showOpenFilePicker?: (options?: unknown) => Promise<FileSystemFileHandle[]>;
  }).showOpenFilePicker;
  if (!picker) return null;
  const handles = await picker({
    multiple: false,
    types: [{ description: 'CryptoBud report JSON', accept: { 'application/json': ['.json'] } }],
  });
  const file = await handles[0]?.getFile();
  if (!file) return null;
  const parsed = JSON.parse(await file.text());
  return parsed?.report ?? parsed;
}

export async function saveBotReport(report: BotReport): Promise<ReportSaveResult> {
  const savedAt = new Date().toISOString();
  const id = `${report.windowHours}h-${report.generatedAt}-${savedAt}`;
  const saved: SavedBotReport = {
    id,
    name: `Last ${report.windowHours}h - ${new Date(report.generatedAt).toLocaleString()}`,
    savedAt,
    windowHours: report.windowHours,
    generatedAt: report.generatedAt,
    report,
  };

  persistSavedBotReports([saved, ...loadSavedBotReports().filter((item) => item.id !== id)]);

  let fileSaved = false;
  let fallbackReason: string | null = null;
  if (selectedDirectoryHandle) {
    try {
      const baseName = safeFilePart(`cryptobud-report-${report.windowHours}h-${report.generatedAt}`);
      const jsonFile = await selectedDirectoryHandle.getFileHandle(`${baseName}.json`, { create: true });
      const jsonWritable = await jsonFile.createWritable();
      await jsonWritable.write(botReportToJson(report));
      await jsonWritable.close();

      const mdFile = await selectedDirectoryHandle.getFileHandle(`${baseName}.md`, { create: true });
      const mdWritable = await mdFile.createWritable();
      await mdWritable.write(botReportToMarkdown(report));
      await mdWritable.close();
      fileSaved = true;
    } catch (err) {
      fallbackReason = err instanceof Error ? err.message : String(err);
    }
  } else {
    fallbackReason = 'No report folder selected';
  }

  return {
    saved,
    fileSaved,
    folderName: selectedDirectoryHandle?.name ?? null,
    fallbackReason,
  };
}

