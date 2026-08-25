/**
 * MiniAppBackgroundDock — resident panel hosting `background` view-mode apps.
 *
 * Background apps do not claim a scene tab; they stay collapsed into this dock
 * (bottom-right), where the user can expand one to interact with it while it
 * keeps running. Closing an entry stops its worker and removes it from the dock.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Loader2, X } from 'lucide-react';
import { miniAppAPI } from '@/infrastructure/api/service-api/MiniAppAPI';
import type { MiniApp } from '@/infrastructure/api/service-api/MiniAppAPI';
import { useAppearance } from '@/infrastructure/appearance';
import { useCurrentWorkspace } from '@/infrastructure/contexts/WorkspaceContext';
import { createLogger } from '@/shared/utils/logger';
import { IconButton } from '@/component-library';
import { useI18n } from '@/infrastructure/i18n';
import { useMiniAppStore } from '../miniAppStore';
import { pickLocalizedString } from '../utils/pickLocalizedString';
import MiniAppRunner from './MiniAppRunner';
import './MiniAppBackgroundDock.scss';

const log = createLogger('MiniAppBackgroundDock');

const MiniAppBackgroundDock: React.FC = () => {
  const apps = useMiniAppStore((state) => state.apps);
  const backgroundAppIds = useMiniAppStore((state) => state.backgroundAppIds);
  const closeBackground = useMiniAppStore((state) => state.closeBackground);
  const markWorkerStopped = useMiniAppStore((state) => state.markWorkerStopped);
  const { current: appearance } = useAppearance();
  const appearanceMode = appearance?.mode ?? 'dark';
  const { workspacePath } = useCurrentWorkspace();
  const { t, currentLanguage } = useI18n('scenes/miniapp');

  const [expanded, setExpanded] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [app, setApp] = useState<MiniApp | null>(null);
  const [loading, setLoading] = useState(false);
  const [strictRuntime, setStrictRuntime] = useState(false);

  const backgroundApps = useMemo(
    () => backgroundAppIds
      .map((id) => apps.find((candidate) => candidate.id === id))
      .filter((value): value is NonNullable<typeof value> => Boolean(value)),
    [backgroundAppIds, apps],
  );

  // Keep an active selection that always points at a resident app.
  useEffect(() => {
    if (backgroundAppIds.length === 0) {
      setActiveId(null);
      return;
    }
    setActiveId((current) =>
      current && backgroundAppIds.includes(current) ? current : backgroundAppIds[0]
    );
  }, [backgroundAppIds]);

  const loadApp = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const loaded = await miniAppAPI.getMiniApp(id, appearanceMode, workspacePath || undefined);
      setStrictRuntime(loaded.runtime_profile === 'market_strict');
      setApp(loaded);
    } catch (error) {
      log.error('Failed to load background MiniApp', error);
      setApp(null);
    } finally {
      setLoading(false);
    }
  }, [appearanceMode, workspacePath]);

  useEffect(() => {
    if (expanded && activeId) {
      void loadApp(activeId);
    } else {
      setApp(null);
    }
  }, [expanded, activeId, loadApp]);

  const handleClose = useCallback(async (id: string) => {
    try {
      await miniAppAPI.workerStop(id);
    } catch (error) {
      log.warn('Stop background worker failed', error);
    } finally {
      markWorkerStopped(id);
      closeBackground(id);
    }
  }, [closeBackground, markWorkerStopped]);

  if (backgroundApps.length === 0) {
    return null;
  }

  const activeApp = backgroundApps.find((candidate) => candidate.id === activeId) ?? backgroundApps[0];
  const activeName = activeApp ? pickLocalizedString(activeApp, currentLanguage, 'name') : 'Mini App';

  return (
    <div
      className="miniapp-bg-dock"
      data-bf-component="miniapp-background-dock"
      data-bf-part="root"
      data-bf-state={expanded ? 'expanded' : 'collapsed'}
    >
      <div className="miniapp-bg-dock__header" data-bf-part="header">
        <span className="miniapp-bg-dock__title">
          {t('dock.title', { count: backgroundApps.length })}
        </span>
        <IconButton
          variant="ghost"
          size="small"
          onClick={() => setExpanded((value) => !value)}
          tooltip={expanded ? t('dock.collapse') : t('dock.expand')}
          aria-label={expanded ? t('dock.collapse') : t('dock.expand')}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </IconButton>
      </div>

      {backgroundApps.length > 1 && expanded && (
        <div className="miniapp-bg-dock__tabs" role="tablist" data-bf-part="tabs">
          {backgroundApps.map((candidate) => {
            const name = pickLocalizedString(candidate, currentLanguage, 'name');
            const isActive = candidate.id === activeApp?.id;
            return (
              <button
                key={candidate.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={[
                  'miniapp-bg-dock__tab',
                  isActive && 'miniapp-bg-dock__tab--active',
                ].filter(Boolean).join(' ')}
                onClick={() => setActiveId(candidate.id)}
              >
                <span className="miniapp-bg-dock__tab-label">{name}</span>
                <span
                  className="miniapp-bg-dock__tab-close"
                  role="button"
                  tabIndex={0}
                  aria-label={t('dock.close')}
                  onClick={(event) => {
                    event.stopPropagation();
                    void handleClose(candidate.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.stopPropagation();
                      void handleClose(candidate.id);
                    }
                  }}
                >
                  <X size={11} />
                </span>
              </button>
            );
          })}
        </div>
      )}

      {expanded && activeApp && (
        <div className="miniapp-bg-dock__body" data-bf-part="body">
          <div className="miniapp-bg-dock__body-header">
            <span className="miniapp-bg-dock__body-title">{activeName}</span>
            <IconButton
              variant="ghost"
              size="small"
              onClick={() => void handleClose(activeApp.id)}
              tooltip={t('dock.close')}
              aria-label={t('dock.close')}
            >
              <X size={14} />
            </IconButton>
          </div>
          <div className="miniapp-bg-dock__runner" data-bf-part="runner">
            {loading && !app && (
              <div className="miniapp-bg-dock__loading" role="status" aria-live="polite">
                <Loader2 size={20} className="miniapp-bg-dock__spinner" strokeWidth={1.5} />
                <span>{t('dock.loading')}</span>
              </div>
            )}
            {app && (
              <MiniAppRunner key={app.id} app={app} strictRuntime={strictRuntime} />
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default MiniAppBackgroundDock;
