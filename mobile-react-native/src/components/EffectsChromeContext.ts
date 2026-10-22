import { createContext, useContext } from 'react';

/** Space occupied inside the effects viewport by the shared, lifted chrome. */
export const EffectsChromeContext = createContext(0);
export const useEffectsBottomInset = () => useContext(EffectsChromeContext);
