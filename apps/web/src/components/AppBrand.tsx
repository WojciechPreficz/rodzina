import { labels } from '../i18n/pl.js';

export function AppBrand() {
  return (
    <div className="app-brand">
      <span className="app-brand-mark" aria-hidden="true">
        r<span>✦</span>
      </span>
      <span>{labels.appName}</span>
    </div>
  );
}
