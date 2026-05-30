import { useEffect, useMemo, useState } from 'react';
import { Landing } from './screens/Landing.js';
import { Lobby } from './screens/Lobby.js';
import { Setup } from './screens/Setup.js';
import { Play } from './screens/Play.js';
import { Replay } from './screens/Replay.js';
import { Designer } from './screens/Designer.js';
import { useGame } from './state.js';

export function App() {
  const phase = useGame((s) => s.phase);
  const [bootError, setBootError] = useState<string | null>(null);

  // Replay mode: either the URL has ?replay=<encoded>, or the user pasted a
  // payload into the "Watch replay" tab on Landing. Either way, skip the socket.
  const urlReplayPayload = useMemo(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get('replay');
    } catch {
      return null;
    }
  }, []);
  const pastedReplay = useGame((s) => s.pastedReplay);
  const designerMode = useGame((s) => s.designerMode);
  const replayPayload = pastedReplay ?? urlReplayPayload;

  useEffect(() => {
    if (replayPayload) return; // replay mode doesn't connect to the server
    if (designerMode) return;  // designer mode doesn't connect either
    useGame.getState().connect().catch((err: unknown) => {
      setBootError(err instanceof Error ? err.message : String(err));
    });
  }, [replayPayload, designerMode]);

  if (replayPayload) {
    return <Replay encoded={replayPayload} />;
  }

  if (designerMode) {
    return <Designer />;
  }

  if (bootError) {
    return (
      <div className="screen-error">
        <h1>Connection error</h1>
        <pre>{bootError}</pre>
      </div>
    );
  }

  if (phase === 'landing') return <Landing />;
  if (phase === 'lobby') return <Lobby />;
  if (phase === 'setup') return <Setup />;
  return <Play />;
}
