import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useApp } from '../state/AppContext';
import type { EqualizerPresetCategory } from '../domain/types';
import type { AdvancedEffects } from '../services/audioEffectState';
import { readEffects } from '../services/effectIsolation';
import { effectEditingTarget } from '../services/effectEditing';
import type { EffectEditTarget } from '../services/effectEditing';

type Draft = {
  target: EffectEditTarget;
  name: string;
  category: EqualizerPresetCategory;
  gains: number[];
  advanced: AdvancedEffects;
  pendingSave: boolean;
  includeAdvanced: boolean;
  readyToSave: boolean;
};
type Session = Draft & {
  patch: (next: Partial<Draft>) => void;
  beginSave: (configureAdvanced: boolean) => void;
  finishAdvanced: (includeAdvanced: boolean) => void;
  saved: () => void;
};
const Context = createContext<Session | null>(null);
export const useEffectEditSession = () => useContext(Context);

/** One page-local draft survives the two mutually mounted editor views. */
export function EffectEditSessionProvider({ children, onEditorChange }: {
  children: React.ReactNode;
  onEditorChange: (editor: 'eq' | 'advanced') => void;
}) {
  const app = useApp();
  const settings = app.state.settings;
  const target = useMemo(() => effectEditingTarget(settings), [settings]);
  const makeDraft = useCallback((): Draft => {
    const selected = readEffects(settings);
    return { target, name: '', category: '自定义', gains: [...selected.gains], advanced: selected.advanced,
      pendingSave: false, includeAdvanced: false, readyToSave: false };
  }, [settings, target]);
  const [draft, setDraft] = useState(makeDraft);
  useEffect(() => {
    if (target.key !== draft.target.key) setDraft(makeDraft());
  }, [target.key, draft.target.key, makeDraft]); // The key guard preserves the draft during audition writes.
  const patch = (next: Partial<Draft>) => setDraft(value => ({ ...value, ...next }));
  return (
    <Context.Provider value={{ ...draft, patch,
      beginSave: configure => {
        patch({ pendingSave: true, includeAdvanced: configure, readyToSave: !configure });
        if (configure) onEditorChange('advanced');
      },
      finishAdvanced: include => {
        patch({ includeAdvanced: include, readyToSave: true });
        onEditorChange('eq');
      },
      saved: () => patch({ name: '', pendingSave: false, includeAdvanced: false, readyToSave: false }),
    }}>{children}</Context.Provider>
  );
}
