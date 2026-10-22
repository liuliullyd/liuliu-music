import type { SourceSetting } from '../domain/types';
import { sourceSettingsText } from './platformPresentation';

/** Only user-imported scripts are supported. No activation or source server exists. */
export function isImportedSource(source: SourceSetting): boolean {
  return typeof source?.id === 'string' && typeof source.script === 'string' &&
    source.script.trim().length > 0 && (!source.origin || source.origin === 'imported') &&
    !/^(?:builtin_|github_source_)/.test(source.id);
}
export const isSourceAuthorized = isImportedSource;
export const isSourceEnabled = (source: SourceSetting) => source.enabled === true && isImportedSource(source);
export const filterImportedSources = (sources: SourceSetting[]) => sources.filter(isImportedSource);
export const sourceDisplayName = (source: Pick<SourceSetting, 'name'>) =>
  sourceSettingsText(source.name.replace(/\.js$/i, '')).trim() || '音源';
