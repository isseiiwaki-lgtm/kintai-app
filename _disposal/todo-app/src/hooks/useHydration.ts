import { useState, useEffect } from 'react';

/**
 * Zustand + persist を Next.js のサーバーサイドレンダリングで安全に使うためのカスタムフック。
 * 初回レンダリング時には null などを返し、クライアントサイドでマウントされた後に実際の state を返します。
 */
export const useHydration = () => {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  return hydrated;
};
