// The notices of the app: one list kept by `App.js`, shared through a context so that any screen
// can put a notice up or take one down, and the band under each `Header` can show one.

import { createContext, useCallback, useContext, useRef, useState } from 'react';

/**
 * What `App.js` provides: `notices`, the open tab, and `show`, `dismiss` and `hold`.
 *
 * A notice is `{ id, kind, tab, where?, title, body, detail?, expiresAfter? }`. `kind` is a key
 * of `noticeColors`; `tab` is the tab it is about, whose icon it shows; `where` lists the tabs it
 * is shown on, every tab when absent; `detail` is what a tap on it opens; `expiresAfter`, in
 * milliseconds, takes it down by itself.
 */
export const NoticesContext = createContext(null);

export function useNotices() {
  return useContext(NoticesContext);
}

/// The list and its changes, for `App.js` to provide. `show` puts a notice up, or replaces the
/// one with its `id`, and starts its time again; `dismiss` takes one down, and does nothing when it
/// is not up; `hold` stops a notice's time, so it stays up while its detail is open.
export function useNoticeList() {
  const [notices, setNotices] = useState([]);
  // The pending take-down of each notice that expires, by id, so a notice shown again restarts
  // its time instead of being taken down by its previous one.
  const timers = useRef({});

  const hold = useCallback((id) => {
    clearTimeout(timers.current[id]);
    delete timers.current[id];
  }, []);

  const dismiss = useCallback(
    (id) => {
      hold(id);
      setNotices((list) => list.filter((notice) => notice.id !== id));
    },
    [hold],
  );

  const show = useCallback(
    (notice) => {
      setNotices((list) => [...list.filter((shown) => shown.id !== notice.id), notice]);
      clearTimeout(timers.current[notice.id]);
      if (notice.expiresAfter) {
        timers.current[notice.id] = setTimeout(() => dismiss(notice.id), notice.expiresAfter);
      }
    },
    [dismiss],
  );

  return { notices, show, dismiss, hold };
}
