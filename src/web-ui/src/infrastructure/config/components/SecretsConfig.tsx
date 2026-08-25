import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';
import { Button, IconButton, Input, confirmDanger } from '@/component-library';
import { useNotification } from '@/shared/notification-system';
import { createLogger } from '@/shared/utils/logger';
import {
  userSecretsAPI,
  type UserSecretSummary,
} from '@/infrastructure/api/service-api/UserSecretsAPI';
import {
  ConfigPageContent,
  ConfigPageHeader,
  ConfigPageLayout,
  ConfigPageLoading,
  ConfigPageMessage,
  ConfigPageRow,
  ConfigPageSection,
} from './common';
import './SecretsConfig.scss';

const log = createLogger('SecretsConfig');

const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const SecretsConfig: React.FC = () => {
  const { t } = useTranslation('settings/secrets');
  const { success, error: notifyError } = useNotification();
  const [loading, setLoading] = useState(true);
  const [secrets, setSecrets] = useState<UserSecretSummary[]>([]);
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState<string | undefined>();

  const refresh = useCallback(async () => {
    try {
      const rows = await userSecretsAPI.list();
      setSecrets(rows);
    } catch (err) {
      log.error('Failed to list user secrets', err);
      notifyError(t('errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [notifyError, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const validateName = (next: string): boolean => {
    if (!next.trim()) {
      setNameError(t('errors.nameRequired'));
      return false;
    }
    if (!NAME_PATTERN.test(next.trim())) {
      setNameError(t('errors.nameInvalid'));
      return false;
    }
    setNameError(undefined);
    return true;
  };

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!validateName(trimmed)) return;
    if (!value) {
      notifyError(t('errors.valueRequired'));
      return;
    }
    setSaving(true);
    try {
      await userSecretsAPI.upsert(trimmed, value);
      setName('');
      setValue('');
      success(t('toast.saved', { name: trimmed }));
      await refresh();
    } catch (err) {
      log.error('Failed to upsert user secret', err);
      notifyError(err instanceof Error ? err.message : t('errors.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (secretName: string) => {
    const confirmed = await confirmDanger(
      t('delete.title'),
      t('delete.message', { name: secretName }),
      {
        confirmText: t('delete.confirm'),
        cancelText: t('delete.cancel'),
      }
    );
    if (!confirmed) return;
    try {
      await userSecretsAPI.delete(secretName);
      success(t('toast.deleted', { name: secretName }));
      await refresh();
    } catch (err) {
      log.error('Failed to delete user secret', err);
      notifyError(t('errors.deleteFailed'));
    }
  };

  if (loading) {
    return <ConfigPageLoading text={t('title')} />;
  }

  return (
    <ConfigPageLayout>
      <ConfigPageHeader title={t('title')} subtitle={t('subtitle')} />
      <ConfigPageContent>
        <ConfigPageSection title={t('sections.add.title')} description={t('sections.add.description')}>
          <ConfigPageRow label={t('fields.name.label')} description={t('fields.name.description')}>
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (nameError) validateName(e.target.value);
              }}
              placeholder={t('fields.name.placeholder')}
              error={Boolean(nameError)}
              errorMessage={nameError}
              autoComplete="off"
              spellCheck={false}
            />
          </ConfigPageRow>
          <ConfigPageRow label={t('fields.value.label')} description={t('fields.value.description')}>
            <Input
              type="password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={t('fields.value.placeholder')}
              autoComplete="new-password"
              spellCheck={false}
            />
          </ConfigPageRow>
          <ConfigPageRow label="" description={t('fields.usageHint')}>
            <Button variant="primary" onClick={() => void handleSave()} disabled={saving}>
              <Plus size={16} />
              <span>{saving ? t('actions.saving') : t('actions.save')}</span>
            </Button>
          </ConfigPageRow>
        </ConfigPageSection>

        <ConfigPageSection
          title={t('sections.list.title')}
          description={t('sections.list.description')}
        >
          {secrets.length === 0 ? (
            <ConfigPageMessage message={{ type: 'info', text: t('list.empty') }} />
          ) : (
            <ul className="bitfun-secrets-list">
              {secrets.map((secret) => (
                <li key={secret.name} className="bitfun-secrets-list__item">
                  <div className="bitfun-secrets-list__meta">
                    <code className="bitfun-secrets-list__name">{`{{${secret.name}}}`}</code>
                    <span className="bitfun-secrets-list__hint">{t('list.valueHidden')}</span>
                  </div>
                  <IconButton
                    size="small"
                    onClick={() => void handleDelete(secret.name)}
                    aria-label={t('actions.delete', { name: secret.name })}
                  >
                    <Trash2 size={14} />
                  </IconButton>
                </li>
              ))}
            </ul>
          )}
        </ConfigPageSection>
      </ConfigPageContent>
    </ConfigPageLayout>
  );
};

export default SecretsConfig;
