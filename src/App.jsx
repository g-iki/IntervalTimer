import React, { useState, useEffect, useRef } from 'react';
import './index.css';

const DEFAULT_SETTINGS = {
  warmup: 10,
  workout: 20,
  rest: 10,
  rounds: 8,
  sets: 3,
  setRest: 30,
  cooldown: 60
};

const PHASES = {
  IDLE: 'idle',
  WARMUP: 'warmup',
  WORKOUT: 'workout',
  REST: 'rest',
  SET_REST: 'setRest',
  COOLDOWN: 'cooldown',
  FINISHED: 'finished'
};

const PHASE_NAMES = {
  [PHASES.WARMUP]: 'Warm Up',
  [PHASES.WORKOUT]: 'Workout',
  [PHASES.REST]: 'Rest',
  [PHASES.SET_REST]: 'Set Rest',
  [PHASES.COOLDOWN]: 'Cooldown',
  [PHASES.FINISHED]: 'Finished'
};

const PHASE_COLORS = {
  [PHASES.WARMUP]: '#f39c12',
  [PHASES.WORKOUT]: '#e74c3c',
  [PHASES.REST]: '#2ecc71',
  [PHASES.SET_REST]: '#3498db',
  [PHASES.COOLDOWN]: '#9b59b6',
  [PHASES.FINISHED]: '#ffffff'
};

const formatTime = (seconds) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = n => n.toString().padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
};

const SettingControl = ({ value, onChange, step, isTime }) => {
  const [localValue, setLocalValue] = useState(isTime ? formatTime(value) : value.toString());
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    if (!isEditing) {
      setLocalValue(isTime ? formatTime(value) : value.toString());
    }
  }, [value, isEditing, isTime]);

  const commitChange = () => {
    let newVal = value;
    const str = localValue.trim();
    if (isTime) {
      // Parse "mm:ss" or "hh:mm:ss" or "ss"
      const parts = str.split(':').map(p => parseInt(p, 10));
      if (!parts.some(isNaN)) {
        if (parts.length === 3) newVal = parts[0] * 3600 + parts[1] * 60 + parts[2];
        else if (parts.length === 2) newVal = parts[0] * 60 + parts[1];
        else if (parts.length === 1) newVal = parts[0];
      }
    } else {
      const parsed = parseInt(str, 10);
      if (!isNaN(parsed)) newVal = parsed;
    }
    onChange(Math.max(0, newVal));
    setIsEditing(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.target.blur();
    }
  };

  return (
    <div className="spin-button">
      <button onClick={() => onChange(value - step)} tabIndex="-1">-</button>
      <input 
        className="spin-input"
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={commitChange}
        onFocus={(e) => { setIsEditing(true); e.target.select(); }}
        onKeyDown={handleKeyDown}
      />
      <button onClick={() => onChange(value + step)} tabIndex="-1">+</button>
    </div>
  );
};


function App() {
  const [settings, setSettings] = useState(() => {
    try {
      const saved = localStorage.getItem('intervalTimerSettings');
      return saved ? JSON.parse(saved) : DEFAULT_SETTINGS;
    } catch (e) {
      return DEFAULT_SETTINGS;
    }
  });

  const [profiles, setProfiles] = useState(() => {
    try {
      const saved = localStorage.getItem('intervalTimerProfiles');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });

  const [profileName, setProfileName] = useState('');
  const [status, setStatus] = useState(PHASES.IDLE);
  const [timeLeft, setTimeLeft] = useState(0);
  const [currentRound, setCurrentRound] = useState(1);
  const [currentSet, setCurrentSet] = useState(1);
  const [isRunning, setIsRunning] = useState(false);
  
  const timerRef = useRef(null);
  const audioContext = useRef(null);
  const wakeLock = useRef(null);

  useEffect(() => {
    localStorage.setItem('intervalTimerSettings', JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    localStorage.setItem('intervalTimerProfiles', JSON.stringify(profiles));
  }, [profiles]);

  useEffect(() => {
    return () => {
      if (wakeLock.current) wakeLock.current.release();
    };
  }, []);

  const initAudio = () => {
    if (!audioContext.current) {
      audioContext.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioContext.current.state === 'suspended') {
      audioContext.current.resume();
    }
  };

  const requestWakeLock = async () => {
    if ('wakeLock' in navigator) {
      try {
        wakeLock.current = await navigator.wakeLock.request('screen');
      } catch (err) {
        console.error('Wake Lock failed:', err);
      }
    }
  };

  // Audio helper
  const playSound = (freq, duration, type = 'sine') => {
    if (!audioContext.current) return;
    const ctx = audioContext.current;
    
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = type;
    osc.frequency.value = freq;
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.start();
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.00001, ctx.currentTime + duration);
    osc.stop(ctx.currentTime + duration);
  };

  const playTick = () => playSound(880, 0.1);
  const playFinished = () => playSound(440, 0.8, 'square');

  // Timer tick logic
  useEffect(() => {
    if (isRunning && timeLeft > 0) {
      timerRef.current = setInterval(() => {
        setTimeLeft((prev) => prev - 1);
      }, 1000);
    } else if (isRunning && timeLeft === 0) {
      handlePhaseTransition();
    }

    return () => clearInterval(timerRef.current);
  }, [isRunning, timeLeft]);

  // Handle countdown sounds
  useEffect(() => {
    if (isRunning && timeLeft > 0 && timeLeft <= 5) {
      playTick();
    } else if (isRunning && timeLeft === 0 && status !== PHASES.IDLE && status !== PHASES.FINISHED) {
      playFinished();
    }
  }, [timeLeft, isRunning]);

  const handlePhaseTransition = () => {
    if (status === PHASES.WARMUP) {
      startWorkout();
    } else if (status === PHASES.WORKOUT) {
      if (currentRound < settings.rounds) {
        if (settings.rest > 0) {
          startPhase(PHASES.REST, settings.rest);
        } else {
           nextRound();
        }
      } else {
        finishSet();
      }
    } else if (status === PHASES.REST) {
      nextRound();
    } else if (status === PHASES.SET_REST) {
      nextSet();
    } else if (status === PHASES.COOLDOWN) {
      finishTotal();
    }
  };

  const startPhase = (phase, time) => {
    setStatus(phase);
    setTimeLeft(time);
  };

  const startWorkout = () => {
    startPhase(PHASES.WORKOUT, settings.workout);
  };

  const nextRound = () => {
    setCurrentRound(r => r + 1);
    startWorkout();
  };

  const finishSet = () => {
    if (currentSet < settings.sets) {
       if (settings.setRest > 0) {
         startPhase(PHASES.SET_REST, settings.setRest);
       } else {
         nextSet();
       }
    } else {
       startCooldown();
    }
  };

  const nextSet = () => {
    setCurrentSet(s => s + 1);
    setCurrentRound(1);
    startWorkout();
  };

  const startCooldown = () => {
    if (settings.cooldown > 0) {
      startPhase(PHASES.COOLDOWN, settings.cooldown);
    } else {
      finishTotal();
    }
  };

  const finishTotal = () => {
    setIsRunning(false);
    setStatus(PHASES.FINISHED);
    playFinished();
    if (wakeLock.current) wakeLock.current.release();
  };

  const handleStart = () => {
    initAudio();
    requestWakeLock();
    
    if (status === PHASES.IDLE || status === PHASES.FINISHED) {
      setCurrentRound(1);
      setCurrentSet(1);
      if (settings.warmup > 0) {
        startPhase(PHASES.WARMUP, settings.warmup);
      } else {
        startWorkout();
      }
    }
    setIsRunning(true);
  };

  const handleReset = () => {
    setIsRunning(false);
    setStatus(PHASES.IDLE);
    setTimeLeft(0);
    setCurrentRound(1);
    setCurrentSet(1);
    if (wakeLock.current) wakeLock.current.release();
  };

  const updateSetting = (key, val) => {
    setSettings(prev => ({...prev, [key]: Math.max(0, val)}));
  };

  const handleSaveProfile = () => {
    if (!profileName.trim()) return;
    const newProfile = {
      id: Date.now().toString(),
      name: profileName.trim(),
      settings: { ...settings }
    };
    setProfiles([...profiles, newProfile]);
    setProfileName('');
    alert('Profile saved!');
  };

  const handleLoadProfile = (profile) => {
    setSettings(profile.settings);
  };

  const handleDeleteProfile = (id) => {
    if(window.confirm('Delete this profile?')) {
      setProfiles(profiles.filter(p => p.id !== id));
    }
  };

  const renderSetting = (key, label, step = 5) => (
    <div key={key} className="setting-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
      <span style={{ fontWeight: 500 }}>{label}</span>
      <SettingControl 
        value={settings[key]} 
        onChange={(v) => updateSetting(key, v)} 
        step={step} 
        isTime={key !== 'rounds' && key !== 'sets'} 
      />
    </div>
  );

  if (status === PHASES.IDLE || status === PHASES.FINISHED) {
    return (
      <div className="container">
        <h1 style={{ textAlign: 'center', marginBottom: '20px', background: '-webkit-linear-gradient(45deg, #e94560, #0f3460)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', fontSize: '2.5rem' }}>Interval Timer</h1>
        
        <div className="glass-panel" style={{ marginBottom: '20px' }}>
          {renderSetting('warmup', 'Warmup Time')}
          {renderSetting('workout', 'Workout Time')}
          {renderSetting('rest', 'Rest Time')}
          {renderSetting('rounds', 'Rounds', 1)}
          {renderSetting('sets', 'Sets', 1)}
          {renderSetting('setRest', 'Set Rest')}
          {renderSetting('cooldown', 'Cooldown')}
        </div>

        <button 
          onClick={handleStart} 
          style={{ width: '100%', fontSize: '1.2rem', padding: '15px', background: 'linear-gradient(to right, #e94560, #ff6b6b)' }}
        >
          {status === PHASES.FINISHED ? 'Restart' : 'Start Workout'}
        </button>  
        
        {status === PHASES.FINISHED && (
             <div style={{textAlign: 'center', marginTop: 20, fontSize: '1.5rem', fontWeight: 'bold'}}>
               Workout Complete!
             </div>
        )}

        {/* Profile Management Section */}
        <div className="glass-panel" style={{ marginTop: '30px' }}>
          <h3 style={{marginBottom: '10px', fontSize: '1.2rem'}}>Save / Load Preset</h3>
          <div style={{display: 'flex', gap: '10px', marginBottom: '20px'}}>
            <input 
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              placeholder="Preset Name"
              style={{
                flex: 1, 
                padding: '10px', 
                borderRadius: '8px', 
                border: '1px solid rgba(255,255,255,0.2)', 
                background: 'rgba(0,0,0,0.3)', 
                color: 'white',
                fontFamily: 'inherit'
              }}
            />
            <button 
               onClick={handleSaveProfile}
               style={{background: '#0984e3', minWidth: '80px'}}
            >
              Save
            </button>
          </div>
          
          <div style={{display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '200px', overflowY: 'auto'}}>
            {profiles.length === 0 && <div style={{opacity: 0.5, textAlign: 'center', padding: '10px'}}>No saved presets</div>}
            {profiles.map(p => (
               <div key={p.id} style={{
                   display: 'flex', 
                   justifyContent: 'space-between', 
                   alignItems: 'center', 
                   background: 'rgba(255,255,255,0.05)', 
                   padding: '10px 15px', 
                   borderRadius: '8px'
               }}>
                 <span style={{fontWeight: 500}}>{p.name}</span>
                 <div style={{display: 'flex', gap: '8px'}}>
                   <button onClick={() => handleLoadProfile(p)} style={{padding: '5px 12px', fontSize: '0.9rem', background: '#00b894'}}>Load</button>
                    <button onClick={() => handleDeleteProfile(p.id)} style={{padding: '5px 12px', fontSize: '0.9rem', background: '#d63031'}}>Del</button>
                 </div>
               </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container" style={{ justifyContent: 'center' }}>
      <div className="glass-panel" style={{ textAlign: 'center', width: '100%', padding: '40px 20px', borderTop: `5px solid ${PHASE_COLORS[status]}` }}>
        <h2 style={{ fontSize: '1.5rem', textTransform: 'uppercase', letterSpacing: '2px', color: PHASE_COLORS[status], marginBottom: '10px' }}>
           {PHASE_NAMES[status]}
        </h2>
        
        <div style={{ fontSize: '5rem', fontWeight: '700', fontVariantNumeric: 'tabular-nums', margin: '20px 0', lineHeight: 1 }}>
          {formatTime(timeLeft)}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '30px' }}>
           <div>
             <div style={{ fontSize: '0.8rem', opacity: 0.7 }}>ROUND</div>
             <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{currentRound} / {settings.rounds}</div>
           </div>
           <div>
             <div style={{ fontSize: '0.8rem', opacity: 0.7 }}>SET</div>
             <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{currentSet} / {settings.sets}</div>
           </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
           <button onClick={() => setIsRunning(!isRunning)} style={{ flex: 1, backgroundColor: isRunning ? '#e74c3c' : '#2ecc71' }}>
             {isRunning ? 'Pause' : 'Resume'}
           </button>
           <button onClick={handleReset} style={{ flex: 1, backgroundColor: '#7f8c8d' }}>
             Reset
           </button>
        </div>
      </div>
    </div>
  );
}

export default App;
