'use client';

import { useToast } from '../ui/toast';
import { useLiveEvent } from '../../lib/api/live';

/** Global render notifications — mounted once in the studio shell. */
export function LiveToasts() {
  const flash = useToast();
  useLiveEvent((event) => {
    if (event.name === 'video.ready') flash('Render finished — output is ready to play');
    else if (event.name === 'video.failed') flash(`Render failed${event.payload.error ? `: ${event.payload.error}` : ''}`);
    else if (event.name === 'pipeline.stage_failed') flash(`Stage ${event.payload.stage ?? ''} failed — retrying`);
  });
  return null;
}
