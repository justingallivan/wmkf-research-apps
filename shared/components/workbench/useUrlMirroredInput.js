/**
 * A text input that the shell mirrors into the URL after a pause in typing.
 *
 * The box is typed locally (filtering can use `input` immediately); `onChange`
 * fires with the value once the user pauses, and the shell writes it to the
 * URL. An external URL change (back button) re-seeds the box.
 */
import { useEffect, useRef, useState } from 'react';

export const URL_INPUT_DEBOUNCE_MS = 300;

export function useUrlMirroredInput(value, onChange, debounceMs = URL_INPUT_DEBOUNCE_MS) {
  const [input, setInput] = useState(value);
  const lastEmittedRef = useRef(value);
  useEffect(() => {
    if (value !== lastEmittedRef.current) {
      lastEmittedRef.current = value;
      setInput(value);
    }
  }, [value]);
  useEffect(() => {
    if (input === lastEmittedRef.current) return undefined;
    const timer = window.setTimeout(() => {
      lastEmittedRef.current = input;
      onChange(input);
    }, debounceMs);
    return () => window.clearTimeout(timer);
  }, [input, onChange, debounceMs]);
  return [input, setInput];
}
