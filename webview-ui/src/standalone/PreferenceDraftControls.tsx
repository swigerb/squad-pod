import type { PreferenceMutation } from '../../../standalone/src/officePreferences.js';
import type { BrowserHostClient } from './browserClient.js';

export function PreferenceDraftControls({ client, draft }: { client: BrowserHostClient; draft: PreferenceMutation }) {
  return <details open>
    <summary>Unacknowledged settings/seat draft</summary>
    <p>Inspect before retrying: this change has not been acknowledged. Other preference changes are rejected until it is resolved. A recovered full seat map may replace current assignments; reconcile or export and discard it first.</p>
    <pre>{JSON.stringify(draft, null, 2)}</pre>
    <button onClick={() => client.send(draft)}>Retry this preference change deliberately</button>
    <button onClick={() => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = 'squad-pod-preference-draft.json'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }}>Export preference draft</button>
    <button onClick={() => client.discardPreferenceDraft()}>Discard preference draft</button>
  </details>;
}
