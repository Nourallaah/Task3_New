import React, { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';
import EqualizerPanel from './components/EqualizerPanel';
import SignalViewer from './components/SignalViewer';
import Spectrogram from './components/Spectrogram';
import AudioControls from './components/AudioControls';
import FrequencyResponse from './components/FrequencyResponse';
import VerticalSlider from './components/VerticalSlider';
import useModeData from './hooks/useModeData';
import { 
  generateAnimalBands, 
  generateHumanBands, 
  generateInstrumentBands,
  handleAnimalSelection, 
  handleHumanSelection, 
  handleInstrumentSelection 
} from './utils/bandGenerator';

const API_BASE = 'http://localhost:5000/api';

function useDebounce(value, delay) {
  const [debouncedValue, setDebouncedValue] = useState(value);
  
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);
    
    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);
  
  return debouncedValue;
}

// تبسيط دالة normalizeSpectrograms لتحسين الأداء
const normalizeSpectrograms = (inputSpectrogram, outputSpectrogram) => {
  if (!inputSpectrogram || !outputSpectrogram || 
      !Array.isArray(inputSpectrogram) || !Array.isArray(outputSpectrogram) ||
      inputSpectrogram.length === 0 || outputSpectrogram.length === 0) {
    return { 
      normalizedInput: null, 
      normalizedOutput: null,
      differenceSpectrogram: null 
    };
  }
  
  const minRows = Math.min(inputSpectrogram.length, outputSpectrogram.length);
  const minCols = Math.min(inputSpectrogram[0]?.length || 0, outputSpectrogram[0]?.length || 0);
  
  if (minRows === 0 || minCols === 0) {
    return { 
      normalizedInput: null, 
      normalizedOutput: null,
      differenceSpectrogram: null 
    };
  }
  
  // Convert to dB scale
  const toDB = (spectrogram) => {
    return spectrogram.map(row => 
      row.map(value => {
        const db = 10 * Math.log10(Math.max(1e-10, value));
        return Math.max(-100, Math.min(0, db));
      })
    );
  };
  
  const inputDB = toDB(inputSpectrogram);
  const outputDB = toDB(outputSpectrogram);
  
  let globalMin = Infinity;
  let globalMax = -Infinity;
  
  // Sample some points for performance
  for (let i = 0; i < minRows; i += 2) {
    for (let j = 0; j < minCols; j += 2) {
      const inputVal = inputDB[i]?.[j];
      const outputVal = outputDB[i]?.[j];
      
      if (inputVal != null && !isNaN(inputVal)) {
        if (inputVal < globalMin) globalMin = inputVal;
        if (inputVal > globalMax) globalMax = inputVal;
      }
      
      if (outputVal != null && !isNaN(outputVal)) {
        if (outputVal < globalMin) globalMin = outputVal;
        if (outputVal > globalMax) globalMax = outputVal;
      }
    }
  }
  
  if (globalMin === globalMax || !isFinite(globalMin) || !isFinite(globalMax)) {
    globalMin = -80;
    globalMax = 0;
  }
  
  // Normalize dB values to [0,1]
  const normalizeDB = (dbSpectrogram) => {
    return dbSpectrogram.map(row => 
      row.map(dbValue => (dbValue - globalMin) / (globalMax - globalMin))
    );
  };
  
  const normalizedInput = normalizeDB(inputDB);
  const normalizedOutput = normalizeDB(outputDB);
  
  // Calculate difference spectrogram
  const differenceSpectrogram = [];
  for (let i = 0; i < minRows; i++) {
    const diffRow = [];
    for (let j = 0; j < minCols; j++) {
      const inputVal = inputSpectrogram[i]?.[j] || 1e-10;
      const outputVal = outputSpectrogram[i]?.[j] || 1e-10;
      const ratio = outputVal / Math.max(1e-10, inputVal);
      const diffDB = 10 * Math.log10(Math.max(1e-3, Math.min(1e3, ratio)));
      const normalizedDiff = Math.max(-1, Math.min(1, diffDB / 12));
      diffRow.push(normalizedDiff);
    }
    differenceSpectrogram.push(diffRow);
  }
  
  return { 
    normalizedInput, 
    normalizedOutput, 
    differenceSpectrogram 
  };
};

function App() {
  const [originalSignal, setOriginalSignal] = useState([]);
  const [processedSignal, setProcessedSignal] = useState([]);
  const [timeAxis, setTimeAxis] = useState([]);
  const [frequencyBands, setFrequencyBands] = useState([]);
  const [sampleRate, setSampleRate] = useState(44100);
  const [inputSpectrogram, setInputSpectrogram] = useState(null);
  const [outputSpectrogram, setOutputSpectrogram] = useState(null);
  const [normalizedInputSpectrogram, setNormalizedInputSpectrogram] = useState(null);
  const [normalizedOutputSpectrogram, setNormalizedOutputSpectrogram] = useState(null);
  const [differenceSpectrogram, setDifferenceSpectrogram] = useState(null);
  const [showSpectrograms, setShowSpectrograms] = useState(false);
  const [showDifference, setShowDifference] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [frequencyResponse, setFrequencyResponse] = useState(null);
  const [showSignalCustomizer, setShowSignalCustomizer] = useState(false);
  const [customFrequencies, setCustomFrequencies] = useState([32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]);
  const [signalDuration, setSignalDuration] = useState(3.0);
  const [isLoadingFrequencyResponse, setIsLoadingFrequencyResponse] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState('');
  const [currentMode, setCurrentMode] = useState('generic');
  const [selectedAnimals, setSelectedAnimals] = useState([]);
  const [selectedHumans, setSelectedHumans] = useState([]);
  const [selectedInstruments, setSelectedInstruments] = useState([]);
  
  // Audio Separation States
  const [separationFile, setSeparationFile] = useState(null);
  const [isSeparating, setIsSeparating] = useState(false);
  const [separatedTracks, setSeparatedTracks] = useState([]);
  const [outputFolder, setOutputFolder] = useState('');
  const [playingSeparatedTrack, setPlayingSeparatedTrack] = useState(null);

  // Use unified mode data hook
  const { data: animalData, isLoading: isLoadingAnimalData } = useModeData('animals');
  const { data: humanData, isLoading: isLoadingHumanData } = useModeData('humans');
  const { data: instrumentData, isLoading: isLoadingInstrumentData } = useModeData('instruments');
  const debouncedFrequencyBands = useDebounce(frequencyBands, 300);
  
  // Add refs to track the original signal and previous values
  const originalSignalRef = useRef([]);

  // Update the ref whenever originalSignal changes
  useEffect(() => {
    originalSignalRef.current = originalSignal;
  }, [originalSignal]);

  // Default generic bands
  const defaultGenericBands = [
    { id: 1, low_freq: 20, high_freq: 60, scale: 1.0, label: '32Hz', center_freq: 32 },
    { id: 2, low_freq: 60, high_freq: 90, scale: 1.0, label: '64Hz', center_freq: 64 },
    { id: 3, low_freq: 90, high_freq: 175, scale: 1.0, label: '125Hz', center_freq: 125 },
    { id: 4, low_freq: 175, high_freq: 350, scale: 1.0, label: '250Hz', center_freq: 250 },
    { id: 5, low_freq: 350, high_freq: 700, scale: 1.0, label: '500Hz', center_freq: 500 },
    { id: 6, low_freq: 700, high_freq: 1400, scale: 1.0, label: '1kHz', center_freq: 1000 },
    { id: 7, low_freq: 1400, high_freq: 2800, scale: 1.0, label: '2kHz', center_freq: 2000 },
    { id: 8, low_freq: 2800, high_freq: 5600, scale: 1.0, label: '4kHz', center_freq: 4000 },
    { id: 9, low_freq: 5600, high_freq: 11200, scale: 1.0, label: '8kHz', center_freq: 8000 },
    { id: 10, low_freq: 11200, high_freq: 20000, scale: 1.0, label: '16kHz', center_freq: 16000 }
  ];

  // Reset frequency bands to default
  const resetFrequencyBands = useCallback(() => {
    setFrequencyBands(defaultGenericBands.map(band => ({ ...band, scale: 1.0 })));
  }, []);

  // Initialize with generic bands
  useEffect(() => {
    resetFrequencyBands();
    generateInitialSignal();
  }, [resetFrequencyBands]);

  useEffect(() => {
    if (originalSignal.length && debouncedFrequencyBands.length) {
      processAudio();
      updateFrequencyResponse();
    }
  }, [debouncedFrequencyBands, originalSignal]);

  // Update bands when selection changes for each mode
  useEffect(() => {
    if (currentMode === 'animals' && selectedAnimals.length > 0) {
      const newBands = generateAnimalBands(selectedAnimals);
      setFrequencyBands(newBands);
    }
  }, [selectedAnimals, currentMode]);

  useEffect(() => {
    if (currentMode === 'humans' && selectedHumans.length > 0) {
      const newBands = generateHumanBands(selectedHumans);
      setFrequencyBands(newBands);
    }
  }, [selectedHumans, currentMode]);

  useEffect(() => {
    if (currentMode === 'instruments' && selectedInstruments.length > 0) {
      const newBands = generateInstrumentBands(selectedInstruments);
      setFrequencyBands(newBands);
    }
  }, [selectedInstruments, currentMode]);

  // Update normalized spectrograms when raw spectrograms change
  useEffect(() => {
    if (inputSpectrogram && outputSpectrogram && 
        Array.isArray(inputSpectrogram) && Array.isArray(outputSpectrogram) &&
        inputSpectrogram.length > 0 && outputSpectrogram.length > 0) {
      
      const { normalizedInput, normalizedOutput, differenceSpectrogram } = normalizeSpectrograms(inputSpectrogram, outputSpectrogram);
      
      setNormalizedInputSpectrogram(normalizedInput);
      setNormalizedOutputSpectrogram(normalizedOutput);
      setDifferenceSpectrogram(differenceSpectrogram);
    } else {
      setNormalizedInputSpectrogram(null);
      setNormalizedOutputSpectrogram(null);
      setDifferenceSpectrogram(null);
    }
  }, [inputSpectrogram, outputSpectrogram]);

  const handleAnimalSelectionWrapper = useCallback((animalLabel) => {
    setSelectedAnimals(prev => 
      handleAnimalSelection(prev, animalLabel, animalData, 3)
    );
  }, [animalData]);

  const handleHumanSelectionWrapper = useCallback((humanLabel) => {
    setSelectedHumans(prev => 
      handleHumanSelection(prev, humanLabel, humanData, 3)
    );
  }, [humanData]);

  const handleInstrumentSelectionWrapper = useCallback((instrumentLabel) => {
    setSelectedInstruments(prev => 
      handleInstrumentSelection(prev, instrumentLabel, instrumentData, 3)
    );
  }, [instrumentData]);

  // Generate initial signal function
  const generateInitialSignal = async () => {
    try {
      const response = await fetch(`${API_BASE}/synthetic-signal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frequencies: [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000],
          duration: 3.0,
          sample_rate: 44100
        })
      });
      
      const data = await response.json();
      if (data.success) {
        setOriginalSignal(data.signal);
        setProcessedSignal(data.signal);
        setTimeAxis(data.time_axis);
        setSampleRate(data.sample_rate);
        setUploadedFileName('');
        
        // Update spectrograms and frequency response
        updateSpectrograms(data.signal, data.signal);
        updateFrequencyResponse();
      }
    } catch (error) {
      console.error('Error generating initial signal:', error);
    }
  };

  // Generate custom signal function
  const generateCustomSignal = async (frequencies, duration) => {
    try {
      const response = await fetch(`${API_BASE}/synthetic-signal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frequencies: frequencies,
          duration: duration,
          sample_rate: 44100
        })
      });
      
      const data = await response.json();
      if (data.success) {
        setOriginalSignal(data.signal);
        setProcessedSignal(data.signal);
        setTimeAxis(data.time_axis);
        setSampleRate(data.sample_rate);
        setUploadedFileName('');
        
        // Update spectrograms and frequency response
        updateSpectrograms(data.signal, data.signal);
        updateFrequencyResponse();
        
        // If we're in a specific mode, reprocess with current bands
        if (currentMode !== 'generic' && frequencyBands.length > 0) {
          processAudio();
        }
      }
    } catch (error) {
      console.error('Error generating custom signal:', error);
    }
  };

  // Add a new function to reset only when explicitly switching to generic mode
  const resetToGenericMode = useCallback(() => {
    resetFrequencyBands();
    setSelectedAnimals([]);
    setSelectedHumans([]);
    setSelectedInstruments([]);
  }, [resetFrequencyBands]);

  // Update the handleModeChange function to use the new reset function only for generic mode:
  const handleModeChange = useCallback((mode) => {
    setCurrentMode(mode);
    
    if (mode === 'generic') {
      resetToGenericMode();
    } else if (mode === 'animals' && animalData && animalData.modes.custom_generated.length > 0) {
      const initialAnimals = animalData.modes.custom_generated.slice(0, 3);
      setSelectedAnimals(initialAnimals);
    } else if (mode === 'humans' && humanData && humanData.modes.custom_generated.length > 0) {
      const initialHumans = humanData.modes.custom_generated.slice(0, 3);
      setSelectedHumans(initialHumans);
    } else if (mode === 'instruments' && instrumentData && instrumentData.modes.custom_generated.length > 0) {
      const initialInstruments = instrumentData.modes.custom_generated.slice(0, 3);
      setSelectedInstruments(initialInstruments);
    }
  }, [resetToGenericMode, animalData, humanData, instrumentData]);

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.wav')) {
      alert('Please upload a WAV file');
      return;
    }

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(`${API_BASE}/upload-audio`, {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();
      if (data.success) {
        setOriginalSignal(data.signal);
        setProcessedSignal(data.signal);
        setTimeAxis(data.time_axis);
        setSampleRate(data.sample_rate);
        setUploadedFileName(file.name);
        
        // Update spectrograms and frequency response
        updateSpectrograms(data.signal, data.signal);
        updateFrequencyResponse();
        
        // If we're in a specific mode, reprocess with current bands
        if (currentMode !== 'generic' && frequencyBands.length > 0) {
          processAudio();
        }
      }
    } catch (error) {
      console.error('Error uploading file:', error);
      alert('Error uploading file. Please try again.');
    }
  };

  // Audio Separation Functions
  const handleSeparationUpload = useCallback((event) => {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.wav')) {
      alert('Please upload a WAV file for separation');
      return;
    }

    setSeparationFile(file);
    setSeparatedTracks([]);
    setOutputFolder('');
  }, []);

  const handleSeparateAudio = async () => {
    if (!separationFile) return;

    setIsSeparating(true);
    try {
      const formData = new FormData();
      formData.append('file', separationFile);

      const response = await fetch(`${API_BASE}/separate`, {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();
      if (data.success) {
        setSeparatedTracks(data.output_files);
        setOutputFolder(data.output_path);
        alert(`Audio separated successfully! Generated ${data.output_files.length} tracks.`);
      } else {
        alert('Error separating audio: ' + (data.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Error separating audio:', error);
      alert('Error separating audio. Please try again.');
    } finally {
      setIsSeparating(false);
    }
  };

  // FIXED: Play separated track function
  const playSeparatedTrack = async (track) => {
    try {
      let trackName, trackPath;
      
      if (typeof track === 'string') {
        trackName = track;
        trackPath = track;
      } else {
        trackName = track.name || 'Unknown Track';
        trackPath = track.path || track.name;
      }
      
      setPlayingSeparatedTrack(trackName);
      
      const cleanPath = trackPath.replace(/\\/g, '/');
      const trackUrl = `${API_BASE}/download/${cleanPath}`;
      
      const audio = new Audio(trackUrl);
      audio.onended = () => setPlayingSeparatedTrack(null);
      audio.onerror = (e) => {
        console.error('Audio playback error:', e);
        setPlayingSeparatedTrack(null);
        alert(`Error playing track: ${trackName}`);
      };
      
      await audio.play();
    } catch (error) {
      console.error('Error playing separated track:', error);
      setPlayingSeparatedTrack(null);
      alert(`Error playing track: ${typeof track === 'string' ? track : track.name}`);
    }
  };

  // Process audio function
  const processAudio = async () => {
    if (!originalSignal.length) return;
    
    setIsProcessing(true);
    try {
      const response = await fetch(`${API_BASE}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signal: originalSignal,
          frequency_bands: frequencyBands,
          sample_rate: sampleRate
        })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      if (data.success) {
        setProcessedSignal(data.processed_signal);
        
        // Update spectrograms with ORIGINAL and PROCESSED signals
        updateSpectrograms(originalSignal, data.processed_signal);
      } else {
        console.error('Backend processing failed:', data);
        alert('Error processing audio: ' + (data.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Error processing audio:', error);
      alert('Error processing audio. Please check the console for details.');
    } finally {
      setIsProcessing(false);
    }
  };

  // Modified updateSpectrograms
  const updateSpectrograms = async (inputSignal, outputSignal) => {
    try {
      // Ensure we have valid signals
      if (!inputSignal.length || !outputSignal.length) {
        return;
      }

      // Update output spectrogram only for performance
      const outputResponse = await fetch(`${API_BASE}/spectrogram`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          signal: outputSignal, 
          sample_rate: sampleRate
        })
      });
      
      if (outputResponse.ok) {
        const outputData = await outputResponse.json();
        if (outputData.success && outputData.spectrogram) {
          setOutputSpectrogram(outputData.spectrogram);
        }
      }
    } catch (error) {
      console.error('Error updating spectrograms:', error);
    }
  };

  const updateFrequencyResponse = async () => {
    if (!frequencyBands.length) return;
    
    setIsLoadingFrequencyResponse(true);
    try {
      const response = await fetch(`${API_BASE}/frequency-response`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signal: originalSignal,
          frequency_bands: frequencyBands,
          sample_rate: sampleRate
        })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data.success && data.frequency_response) {
        setFrequencyResponse(data.frequency_response);
      }
    } catch (error) {
      console.error('Error updating frequency response:', error);
      setFrequencyResponse(null);
    } finally {
      setIsLoadingFrequencyResponse(false);
    }
  };

  const saveSettings = async () => {
    try {
      const response = await fetch(`${API_BASE}/save-settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: {
            frequency_bands: frequencyBands,
            version: '1.0',
            created: new Date().toISOString()
          },
          filename: 'equalizer_settings.json'
        })
      });
      
      const data = await response.json();
      if (data.success) {
        alert('Settings saved successfully!');
      }
    } catch (error) {
      console.error('Error saving settings:', error);
    }
  };

  // Also update the resetEqualizer function to preserve mode-specific bands:
  const resetEqualizer = useCallback(() => {
    if (currentMode === 'generic') {
      resetFrequencyBands();
    } else {
      const resetBands = frequencyBands.map(band => ({
        ...band,
        scale: 1.0
      }));
      setFrequencyBands(resetBands);
    }
  }, [currentMode, frequencyBands, resetFrequencyBands]);

  const updateBand = useCallback((index, field, value) => {
    const newBands = [...frequencyBands];
    newBands[index] = {
      ...newBands[index],
      [field]: parseFloat(value) || 0
    };
    setFrequencyBands(newBands);
  }, [frequencyBands]);

  const handleSliderChange = useCallback((index, value) => {
    updateBand(index, 'scale', value);
  }, [updateBand]);

  const removeBand = useCallback((index) => {
    if (frequencyBands.length > 1) {
      const newBands = frequencyBands.filter((_, i) => i !== index);
      setFrequencyBands(newBands);
    }
  }, [frequencyBands]);

  const formatFrequency = (freq) => {
    if (freq >= 1000) {
      return `${(freq / 1000).toFixed(1)}k`;
    }
    return `${Math.round(freq)}`;
  };

  return (
    <div className="App">
      <div className="main-container">
        {/* Visualization Section - Left side */}
        <div className="visualization-section">
          {/* Signal Graphs Container */}
          <div className="signal-graphs-container">
            {/* Time Domain Graphs */}
            <div className="signal-graphs-row">
              <SignalViewer
                title="Input Signal (Time Domain)"
                signal={originalSignal}
                timeAxis={timeAxis}
                color="#4A90E2"
                sampleRate={sampleRate}
                type="time"
              />
              <SignalViewer
                title="Output Signal (Time Domain)"
                signal={processedSignal}
                timeAxis={timeAxis}
                color="#50E3C2"
                sampleRate={sampleRate}
                type="time"
              />
            </div>

            {/* Frequency Domain Graphs */}
            <div className="signal-graphs-row">
              <SignalViewer
                title="Input Signal (Frequency Domain)"
                signal={originalSignal}
                timeAxis={timeAxis}
                color="#4A90E2"
                sampleRate={sampleRate}
                type="frequency"
              />
              <SignalViewer
                title="Output Signal (Frequency Domain)"
                signal={processedSignal}
                timeAxis={timeAxis}
                color="#50E3C2"
                sampleRate={sampleRate}
                type="frequency"
              />
            </div>
          </div>

          {/* Horizontal Vertical Sliders Container */}
          <div className="vertical-sliders-container">
            <div className="sliders-header">
              <h4>
                {currentMode === 'animals' ? 'Animal Frequency Range Controls' : 
                 currentMode === 'humans' ? 'Human Voice Frequency Controls' :
                 currentMode === 'instruments' ? 'Instrument Frequency Controls' : 
                 'Frequency Band Controls'}
              </h4>
              <p>
                {currentMode === 'animals' 
                  ? 'Adjust amplitude scales for each animal frequency range' 
                  : currentMode === 'humans'
                  ? 'Adjust amplitude scales for each human voice frequency range'
                  : currentMode === 'instruments'
                  ? 'Adjust amplitude scales for each instrument frequency range'
                  : 'Adjust amplitude scales (0-2) for each frequency subdivision'}
              </p>
            </div>
            
            <div className="vertical-sliders-horizontal">
              {frequencyBands.map((band, index) => (
                <div key={band.id} className="band-vertical-container">
                  <VerticalSlider
                    value={band.scale}
                    onChange={(value) => handleSliderChange(index, value)}
                    label={band.label}
                    freqLabel={`${formatFrequency(band.low_freq)}-${formatFrequency(band.high_freq)}Hz`}
                    color={band.color || '#3498DB'}
                    onRemove={() => removeBand(index)}
                    showRemove={currentMode === 'generic'}
                  />
                </div>
              ))}
            </div>

            <div className="sliders-footer">
              <div className="db-scale">
                <span>+12dB</span>
                <span>0dB</span>
                <span>-12dB</span>
              </div>
              <div className="scale-info">
                Scale: 0.0 (mute) to 2.0 (+12dB boost)
              </div>
            </div>
          </div>

          <div className="spectrogram-controls">
            <button 
              onClick={() => setShowSpectrograms(!showSpectrograms)}
              className="toggle-button"
            >
              {showSpectrograms ? 'Hide Spectrograms' : 'Show Spectrograms'}
            </button>
            {showSpectrograms && (
              <button 
                onClick={() => setShowDifference(!showDifference)}
                className="toggle-button"
                style={{ marginLeft: '10px' }}
              >
                {showDifference ? 'Show Normal' : 'Show Difference'}
              </button>
            )}
          </div>

          {showSpectrograms && (
            <div className="spectrograms-horizontal">
              {showDifference ? (
                <>
                  <Spectrogram
                    title="Difference Spectrogram (Output - Input)"
                    spectrogramData={differenceSpectrogram}
                    sampleRate={sampleRate}
                    signalLength={originalSignal.length}
                  />
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '20px',
                    color: '#BDC3C7',
                    textAlign: 'center'
                  }}>
                    <h4>Difference Spectrogram</h4>
                    <p>Red: Frequencies boosted by equalizer</p>
                    <p>Blue: Frequencies cut by equalizer</p>
                    <p>White: No change</p>
                  </div>
                </>
              ) : (
                <>
                  <Spectrogram
                    title="Input Spectrogram"
                    spectrogramData={normalizedInputSpectrogram}
                    sampleRate={sampleRate}
                    signalLength={originalSignal.length}
                  />
                  <Spectrogram
                    title="Output Spectrogram"
                    spectrogramData={normalizedOutputSpectrogram}
                    sampleRate={sampleRate}
                    signalLength={processedSignal.length}
                  />
                </>
              )}
            </div>
          )}
        </div>

        {/* Control Section - Right side */}
        <div className="control-section">
          <EqualizerPanel
            frequencyBands={frequencyBands}
            onBandsChange={setFrequencyBands}
            onSave={saveSettings}
            onReset={resetEqualizer}
            isProcessing={isProcessing}
            frequencyResponse={frequencyResponse}
            onCustomizeSignal={() => setShowSignalCustomizer(true)}
            onFileUpload={handleFileUpload}
            currentMode={currentMode}
            onModeChange={handleModeChange}
            animalData={animalData}
            isLoadingAnimalData={isLoadingAnimalData}
            selectedAnimals={selectedAnimals}
            onAnimalSelection={handleAnimalSelectionWrapper}
            humanData={humanData}
            isLoadingHumanData={isLoadingHumanData}
            selectedHumans={selectedHumans}
            onHumanSelection={handleHumanSelectionWrapper}
            instrumentData={instrumentData}
            isLoadingInstrumentData={isLoadingInstrumentData}
            selectedInstruments={selectedInstruments}
            onInstrumentSelection={handleInstrumentSelectionWrapper}
            // Audio Separation Props
            onSeparationUpload={handleSeparationUpload}
            onSeparateAudio={handleSeparateAudio}
            isSeparating={isSeparating}
            separatedTracks={separatedTracks}
            separationFile={separationFile}
            outputFolder={outputFolder}
            playingSeparatedTrack={playingSeparatedTrack}
            onPlaySeparatedTrack={playSeparatedTrack}
          />
          
          {/* Frequency Response */}
          {isLoadingFrequencyResponse ? (
            <div className="controls-frequency-response">
              <div style={{textAlign: 'center', color: '#BDC3C7', padding: '20px'}}>
                Calculating Frequency Response...
              </div>
            </div>
          ) : frequencyResponse ? (
            <div className="controls-frequency-response">
              <FrequencyResponse frequencyResponse={frequencyResponse} />
            </div>
          ) : (
            <div className="controls-frequency-response">
              <div style={{textAlign: 'center', color: '#95A5A6', padding: '20px'}}>
                No Frequency Response Data
              </div>
            </div>
          )}

          {/* Audio Playback */}
          <div className="controls-audio-playback">
            <AudioControls
              inputSignal={originalSignal}
              outputSignal={processedSignal}
              sampleRate={sampleRate}
            />
          </div>
        </div>
      </div>

      {/* Signal Customizer Modal */}
      {showSignalCustomizer && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>Customize Synthetic Signal</h3>

            <div className="frequency-sliders" style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', color: '#BDC3C7', fontWeight: '500' }}>
                Frequency Components (Hz):
              </label>
              {customFrequencies.map((freq, index) => (
                <div key={index} style={{ marginBottom: '10px' }}>
                  <label style={{ fontSize: '0.8em', color: '#BDC3C7' }}>
                    Frequency {index + 1}: {freq}Hz
                  </label>
                  <input
                    type="range"
                    min="20"
                    max="20000"
                    step="1"
                    value={freq}
                    onChange={(e) => {
                      const newFreq = parseInt(e.target.value);
                      const newFrequencies = [...customFrequencies];
                      newFrequencies[index] = newFreq;
                      setCustomFrequencies(newFrequencies);
                    }}
                    style={{
                      width: '100%',
                      marginTop: '5px'
                    }}
                  />
                </div>
              ))}
            </div>

            <div className="duration-input">
              <label style={{ display: 'block', marginBottom: '8px', color: '#BDC3C7', fontWeight: '500' }}>
                Duration (seconds):
              </label>
              <input
                type="range"
                min="0.1"
                max="10"
                step="0.1"
                value={signalDuration}
                onChange={(e) => setSignalDuration(parseFloat(e.target.value))}
                style={{ width: '100%', marginBottom: '5px' }}
              />
              <span style={{ color: '#3498DB', fontSize: '0.9em' }}>{signalDuration}s</span>
            </div>

            <div className="modal-buttons">
              <button onClick={() => {
                generateCustomSignal(customFrequencies, signalDuration);
                setShowSignalCustomizer(false);
              }} className="btn btn-generate">
                Generate Signal
              </button>
              <button onClick={() => setShowSignalCustomizer(false)} className="btn btn-reset">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;