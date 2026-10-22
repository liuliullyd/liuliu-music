import React, { createContext, useContext, useMemo } from 'react';
import { adaptivePageMetrics, type AdaptivePageMetrics } from '../layout';

const LayoutContext = createContext<AdaptivePageMetrics>(
  adaptivePageMetrics(720),
);

export function LayoutProvider({
  designHeight,
  scale = 1,
  children,
}: {
  designHeight: number;
  scale?: number;
  children: React.ReactNode;
}) {
  const value = useMemo(
    () => adaptivePageMetrics(designHeight, scale),
    [designHeight, scale],
  );
  return (
    <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>
  );
}

export const useLayout = () => useContext(LayoutContext);
