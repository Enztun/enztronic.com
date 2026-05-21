'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export function useLiveData() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const es = new EventSource('/api/stream');

    es.addEventListener('positions_changed', () => {
      queryClient.invalidateQueries({ queryKey: ['positions'] });
      queryClient.invalidateQueries({ queryKey: ['health'] });
      queryClient.invalidateQueries({ queryKey: ['pnl'] });
    });

    es.addEventListener('decision_added', () => {
      queryClient.invalidateQueries({ queryKey: ['decisions'] });
    });

    es.addEventListener('candidates_changed', () => {
      queryClient.invalidateQueries({ queryKey: ['candidates'] });
    });

    es.onerror = () => {
      // EventSource auto-reconnects on error — no manual retry needed
    };

    return () => es.close();
  }, [queryClient]);
}
