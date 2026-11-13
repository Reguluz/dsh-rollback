/**
 * Client half of @local/dsh-rollback.
 *
 * Registers one page in the Settings panel (settings.section) plus its
 * navigation icon (settings.section.icon). The page reloads the release
 * list from the Host route every time it mounts, marks the running
 * version, and offers a one-click download of any older release's
 * source archive into the dedicated rollback folder.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-rollback',
  factory(require) {
    const React = require('react');
    const { useEffect, useRef, useState } = React;
    const h = React.createElement;

    const dict = {
      en: {
        title: 'Version rollback',
        intro:
          'Fetches the DeepSeek Harness release list from GitHub. Download an older version to the dedicated rollback folder, then install it manually to recover from an accidental upgrade.',
        current: 'Current version',
        refresh: 'Refresh',
        loading: 'Loading releases…',
        empty: 'No releases found.',
        prerelease: 'Pre-release',
        running: 'Running',
        download: 'Download',
        downloading: 'Downloading…',
        done: 'Downloaded',
        openFile: 'Open file',
        openFolder: 'Open downloads folder',
        failed: 'Failed',
        retry: 'Retry',
        saveTo: 'Downloads are saved to',
        fetchError: 'Failed to load releases',
      },
      zh: {
        title: '版本回退',
        intro:
          '从 GitHub 读取 DeepSeek Harness 的版本发布列表。可一键下载旧版本到独立的回退目录，再手动安装，用于撤销误升级。',
        current: '当前版本',
        refresh: '刷新',
        loading: '正在读取版本列表…',
        empty: '未找到任何版本。',
        prerelease: '预发布',
        running: '运行中',
        download: '下载',
        downloading: '下载中…',
        done: '已下载',
        openFile: '打开文件',
        openFolder: '打开下载文件夹',
        failed: '失败',
        retry: '重试',
        saveTo: '下载保存位置',
        fetchError: '读取版本列表失败',
      },
    };

    function formatBytes(n) {
      if (!n) return '';
      if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
      if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
      return `${n} B`;
    }

    function formatDate(iso) {
      if (!iso) return '';
      try {
        return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
      } catch {
        return iso.slice(0, 10);
      }
    }

    function currentLanguage() {
      try {
        const lang = (typeof navigator !== 'undefined' && navigator.language) || 'en';
        return lang.toLowerCase().startsWith('zh') ? 'zh' : 'en';
      } catch {
        return 'en';
      }
    }

    function Page(props) {
      const t = (key) => dict[currentLanguage()][key] ?? dict.en[key] ?? key;

      const [state, setState] = useState({ phase: 'loading', releases: [], currentVersion: null, downloadDir: '', error: null });
      const [jobs, setJobs] = useState({});
      const [reloadCount, setReloadCount] = useState(0);
      const aliveRef = useRef(true);

      useEffect(() => {
        aliveRef.current = true;
        const load = async () => {
          try {
            const response = await fetch('/dsh-rollback/releases', { cache: 'no-store' });
            const data = await response.json();
            if (!aliveRef.current) return;
            if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
            setState({ phase: 'ready', releases: data.releases || [], currentVersion: data.currentVersion, downloadDir: data.downloadDir || '', error: null });
          } catch (error) {
            if (aliveRef.current) setState({ phase: 'error', releases: [], currentVersion: null, downloadDir: '', error: String(error?.message || error) });
          }
        };
        load();
        return () => {
          aliveRef.current = false;
        };
      }, [reloadCount]);

      // Poll download jobs while at least one is active.
      useEffect(() => {
        const active = Object.values(jobs).some((job) => job.state === 'downloading');
        if (!active) return undefined;
        const timer = setInterval(async () => {
          try {
            const response = await fetch('/dsh-rollback/status', { cache: 'no-store' });
            const data = await response.json();
            if (!response.ok) return;
            const next = {};
            for (const job of data.jobs || []) next[job.tag] = job;
            setJobs(next);
          } catch {
            /* transient */
          }
        }, 600);
        return () => clearInterval(timer);
      }, [jobs]);

      const startDownload = async (release) => {
        const url = release.zipballUrl || release.tarballUrl;
        if (!url) return;
        setJobs((prev) => ({ ...prev, [release.tag]: { tag: release.tag, state: 'downloading', received: 0, total: 0 } }));
        try {
          await fetch('/dsh-rollback/download', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ tag: release.tag, url }),
          });
        } catch {
          setJobs((prev) => ({ ...prev, [release.tag]: { tag: release.tag, state: 'error', error: 'request failed' } }));
        }
      };

      const openTarget = async (query) => {
        try {
          await fetch(`/dsh-rollback/open?${query}`, { cache: 'no-store' });
        } catch {
          /* transient */
        }
      };

      const rowStyle = {
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '10px 12px',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
      };
      const buttonStyle = {
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-2)',
        color: 'var(--dsw-alias-label-primary)',
        borderRadius: '6px',
        padding: '4px 12px',
        fontSize: '13px',
        cursor: 'pointer',
      };
      const badgeStyle = (color) => ({
        border: `1px solid ${color}`,
        color,
        borderRadius: '999px',
        fontSize: '11px',
        padding: '1px 8px',
        lineHeight: '16px',
        whiteSpace: 'nowrap',
      });

      const children = [
        h('p', { key: 'intro', style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '13px', margin: '0 0 8px' } }, t('intro')),
        state.downloadDir
          ? h('p', { key: 'dir', style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px', margin: '0 0 12px' } },
              `${t('saveTo')}: `, h('code', null, state.downloadDir))
          : null,
        state.phase === 'loading'
          ? h('p', { key: 'loading', style: { color: 'var(--dsw-alias-label-secondary)' } }, t('loading'))
          : null,
        state.phase === 'error'
          ? h('p', { key: 'error', style: { color: 'var(--dsw-alias-state-error-primary)' } },
              `${t('fetchError')}: ${state.error}`)
          : null,
      ];

      if (state.phase === 'ready') {
        children.push(
          h('div', { key: 'head', style: { display: 'flex', alignItems: 'center', gap: '8px', margin: '0 0 8px' } },
            h('span', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '13px' } },
              `${t('current')}: `, h('code', null, state.currentVersion || '?')),
            h('button', {
              style: { ...buttonStyle, marginLeft: 'auto' },
              onClick: () => setReloadCount((n) => n + 1),
            }, t('refresh')),
            h('button', {
              style: buttonStyle,
              onClick: () => openTarget('folder=1'),
            }, t('openFolder'))),
        );
        if (!state.releases.length) {
          children.push(h('p', { key: 'empty', style: { color: 'var(--dsw-alias-label-secondary)' } }, t('empty')));
        }
        for (const release of state.releases) {
          const job = jobs[release.tag];
          const isCurrent = state.currentVersion && release.tag === `dsh-v${state.currentVersion}`;
          const downloadUrl = release.zipballUrl || release.tarballUrl;
          let action = null;
          if (job?.state === 'downloading') {
            const pct = job.total ? Math.floor((job.received / job.total) * 100) : null;
            action = h('span', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px', whiteSpace: 'nowrap' } },
              pct === null ? t('downloading') : `${t('downloading')} ${pct}% (${formatBytes(job.received)})`);
          } else if (job?.state === 'done') {
            action = h('button', {
              style: { ...buttonStyle, color: 'var(--dsw-alias-state-success-primary)' },
              onClick: () => openTarget(`tag=${encodeURIComponent(job.tag)}`),
            }, t('openFile'));
          } else if (job?.state === 'error') {
            action = h('span', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
              h('span', { style: { color: 'var(--dsw-alias-state-error-primary)', fontSize: '12px' } }, `${t('failed')}: ${job.error || ''}`),
              h('button', { style: buttonStyle, onClick: () => startDownload(release) }, t('retry')));
          } else if (isCurrent) {
            action = h('span', { style: badgeStyle('var(--dsw-alias-state-success-primary)') }, t('running'));
          } else if (downloadUrl) {
            action = h('button', { style: buttonStyle, onClick: () => startDownload(release) }, t('download'));
          }
          children.push(
            h('div', { key: release.tag, style: rowStyle },
              h('span', { style: { fontWeight: 500, whiteSpace: 'nowrap' } }, release.name || release.tag),
              release.prerelease ? h('span', { style: badgeStyle('var(--dsw-alias-state-warn-primary)') }, t('prerelease')) : null,
              h('span', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px' } }, formatDate(release.publishedAt)),
              h('span', { style: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' } }, action),
            ),
          );
        }
      }

      return h('div', { style: { display: 'flex', flexDirection: 'column', minHeight: 0 } }, children);
    }

    function NavIcon() {
      return h('svg', { viewBox: '0 0 24 24', width: 16, height: 16, 'aria-hidden': true },
        h('path', {
          d: 'M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z',
          fill: 'currentColor',
        }));
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const label = () => dict[currentLanguage()].title;
        return ctx.effect(() => {
          const disposers = [
            ctx.slots.inject('settings.section', () =>
              ctx.slots.register({ name: 'settings.section', id: 'dsh-rollback', order: 90, label }, Page)),
            ctx.slots.inject('settings.section.icon', () =>
              ctx.slots.register({ name: 'settings.section.icon', id: 'dsh-rollback' }, NavIcon)),
          ];
          return () => disposers.forEach((d) => d?.());
        });
      },
    };
  },
});
