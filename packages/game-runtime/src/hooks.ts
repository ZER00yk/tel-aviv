"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameSDK } from "@tell-aviv/game-sdk";
export function useGameState<T>(sdk: GameSDK) {
  const [state, setState] = useState<T | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  const action = useCallback(
    async (name: string, payload: Record<string, unknown> = {}) => {
      setBusy(true);
      setError("");
      try {
        const response = await sdk.action<T>(name, payload);
        if (mounted.current) setState(response.state);
        return response;
      } catch (e) {
        if (mounted.current)
          setError(e instanceof Error ? e.message : "Action failed");
        return null;
      } finally {
        if (mounted.current) setBusy(false);
      }
    },
    [sdk],
  );
  useEffect(() => {
    mounted.current = true;
    void action("state");
    return () => {
      mounted.current = false;
    };
  }, [action]);
  return { state, error, busy, action };
}
export function useCloudSave<T>(sdk: GameSDK, initial: T) {
  const [data, setData] = useState<T>(initial),
    [message, setMessage] = useState(""),
    [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    sdk
      .load<T>()
      .then((save) => {
        if (alive) {
          if (save.data) setData(save.data);
          setLoaded(true);
        }
      })
      .catch((e) => {
        if (alive) {
          setMessage(e.message);
          setLoaded(true);
        }
      });
    return () => {
      alive = false;
    };
  }, [sdk]);
  const save = async (value = data) => {
    try {
      await sdk.save(value);
      setMessage("Saved to your cloud");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Save failed");
    }
  };
  return { data, setData, save, message, loaded };
}
