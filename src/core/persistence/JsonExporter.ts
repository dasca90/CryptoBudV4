import type { Journal } from './Journal';
import { sanitizeCredentialArtifactJson } from '../security/credentialRedaction';

export class JsonExporter {
  private journal: Journal;

  constructor(journal: Journal) {
    this.journal = journal;
  }

  async exportTrades(): Promise<{ json: string; filename: string }> {
    const json = await this.journal.exportJson();
    const filename = `cryptobud_journal_${new Date().toISOString().slice(0, 10)}.json`;
    return { json: sanitizeCredentialArtifactJson(json), filename };
  }

  async exportML(): Promise<{ json: string; filename: string }> {
    const json = await this.journal.exportMLData();
    const filename = `cryptobud_ml_dataset_${new Date().toISOString().slice(0, 10)}.json`;
    return { json: sanitizeCredentialArtifactJson(json), filename };
  }

  async exportTrainingRows(): Promise<{ json: string; filename: string }> {
    const json = await this.journal.exportTrainingRows();
    const filename = `cryptobud_ml_training_${new Date().toISOString().slice(0, 10)}.json`;
    return { json: sanitizeCredentialArtifactJson(json), filename };
  }

  async exportAdvisoryRows(): Promise<{ json: string; filename: string }> {
    const json = await this.journal.exportAdvisoryRows();
    const filename = `cryptobud_ml_advisory_${new Date().toISOString().slice(0, 10)}.json`;
    return { json: sanitizeCredentialArtifactJson(json), filename };
  }

  async exportExcludedRows(): Promise<{ json: string; filename: string }> {
    const json = await this.journal.exportExcludedRows();
    const filename = `cryptobud_ml_excluded_${new Date().toISOString().slice(0, 10)}.json`;
    return { json: sanitizeCredentialArtifactJson(json), filename };
  }

  download(json: string, filename: string): void {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
}
