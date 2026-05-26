import { useEffect, useState } from 'react';
import { Landing } from './screens/Landing.js';
import { Lobby } from './screens/Lobby.js';
import { Setup } from './screens/Setup.js';
import { Play } from './screens/Play.js';
import { useGame } from './state.js';

export function App() {
  const phase = useGame((s) => s.phase);
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    useGame.getState().connect().catch((err: unknown) => {
      setBootError(err instanceof Error ? err.message : String(err));
    });
  }, []);

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
