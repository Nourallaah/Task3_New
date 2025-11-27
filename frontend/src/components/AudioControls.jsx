// components/AudioControls.jsx
import React, { useRef, useState, useEffect } from 'react';
import './AudioControls.css';

const AudioControls = ({ inputSignal, outputSignal, sampleRate }) => {
  const audioContextRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentSignal, setCurrentSignal] = useState(null);
  const animationRef = useRef(null);

  // Calculate duration when signals change
  useEffect(() => {
    if (inputSignal.length > 0) {
      setDuration(inputSignal.length / sampleRate);
    }
  }, [inputSignal, sampleRate]);

  const playSignal = async (signal, signalType) => {
    if (!signal.length) return;

    // Stop any currently playing audio
    stopAudio();

    try {
      // Create or reuse AudioContext
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }

      const audioContext = audioContextRef.current;
      
      // Resume context if it's suspended (browser autoplay policy)
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      const buffer = audioContext.createBuffer(1, signal.length, sampleRate);
      const channelData = buffer.getChannelData(0);
      
      // Copy signal to audio buffer
      for (let i = 0; i < signal.length; i++) {
        channelData[i] = signal[i];
      }

      // Create and play source
      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContext.destination);
      
      // Set up playback tracking
      const startTime = audioContext.currentTime;
      setCurrentSignal(signalType);
      setIsPlaying(true);
      setCurrentTime(0);

      // Animation loop for real-time playback visualization
      const animate = () => {
        const elapsed = audioContext.currentTime - startTime;
        setCurrentTime(elapsed);
        
        if (elapsed < duration && isPlaying) {
          animationRef.current = requestAnimationFrame(animate);
        } else if (elapsed >= duration) {
          setIsPlaying(false);
          setCurrentTime(0);
          setCurrentSignal(null);
        }
      };

      // Set up event listeners
      source.onended = () => {
        setIsPlaying(false);
        setCurrentTime(0);
        setCurrentSignal(null);
        cancelAnimationFrame(animationRef.current);
      };
      
      source.start();
      animate();
      
    } catch (error) {
      console.error('Error playing audio:', error);
      setIsPlaying(false);
      setCurrentSignal(null);
    }
  };

  const stopAudio = () => {
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    setIsPlaying(false);
    setCurrentTime(0);
    setCurrentSignal(null);
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="audio-controls">
      <h3>Audio Playback</h3>
      <div className="audio-status">
        Status: <span className={isPlaying ? 'status-playing' : 'status-stopped'}>
          {isPlaying ? `PLAYING ${currentSignal?.toUpperCase()}` : 'STOPPED'}
        </span>
      </div>
      
      {/* Playback Progress */}
      <div className="playback-progress">
        <div className="time-display">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
        <div className="progress-bar">
          <div 
            className="progress-fill"
            style={{ width: `${(currentTime / duration) * 100}%` }}
          />
        </div>
      </div>

      <div className="audio-buttons">
        <button 
          onClick={() => playSignal(inputSignal, 'input')} 
          disabled={!inputSignal.length || isPlaying}
          className="btn btn-audio btn-input"
        >
          Play Input
        </button>
        <button 
          onClick={() => playSignal(outputSignal, 'output')} 
          disabled={!outputSignal.length || isPlaying}
          className="btn btn-audio btn-output"
        >
          Play Output
        </button>
        <button 
          onClick={stopAudio}
          disabled={!isPlaying}
          className="btn btn-audio btn-stop"
        >
          Stop
        </button>
      </div>

      <div className="audio-info">
        <p>Sample Rate: {sampleRate} Hz</p>
        <p>Duration: {duration.toFixed(2)}s</p>
      </div>
    </div>
  );
};

export default AudioControls;