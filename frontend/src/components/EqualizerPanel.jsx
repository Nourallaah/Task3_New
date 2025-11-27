import React from 'react';
import './EqualizerPanel.css';
import ModePanel from './ModePanel';

const EqualizerPanel = ({ 
  frequencyBands, 
  onBandsChange, 
  onSave, 
  onReset,
  isProcessing,
  frequencyResponse,
  onCustomizeSignal,
  onFileUpload,
  currentMode,
  onModeChange,
  animalData,
  isLoadingAnimalData,
  selectedAnimals,
  onAnimalSelection,
  humanData,
  isLoadingHumanData,
  selectedHumans,
  onHumanSelection,
  instrumentData,
  isLoadingInstrumentData,
  selectedInstruments,
  onInstrumentSelection,
  // Audio Separation Props
  onSeparationUpload,
  onSeparateAudio,
  isSeparating,
  separatedTracks,
  separationFile,
  outputFolder,
  playingSeparatedTrack,
  onPlaySeparatedTrack
}) => {

  const addBand = () => {
    const maxFreq = frequencyBands.length > 0 
      ? Math.max(...frequencyBands.map(band => band.high_freq))
      : 20;
    const newHighFreq = Math.min(maxFreq * 1.5, 20000);
    
    const newBand = {
      id: Date.now(),
      low_freq: maxFreq,
      high_freq: newHighFreq,
      scale: 1.0,
      label: `${Math.round(maxFreq)}-${Math.round(newHighFreq)}Hz`,
      center_freq: Math.sqrt(maxFreq * newHighFreq)
    };
    onBandsChange([...frequencyBands, newBand]);
  };

  const handleFileUpload = (event) => {
    onFileUpload(event);
  };

  const getModeTitle = () => {
    switch(currentMode) {
      case 'animals':
        return 'ANIMALS MODE';
      case 'humans':
        return 'HUMANS MODE';
      case 'instruments':
        return 'INSTRUMENTS MODE';
      default:
        return 'GENERIC MODE';
    }
  };

  const getModePanelProps = () => {
    switch(currentMode) {
      case 'animals':
        return {
          modeData: animalData,
          isLoading: isLoadingAnimalData,
          selectedItems: selectedAnimals,
          onItemSelection: onAnimalSelection,
          title: 'Select Animals'
        };
      case 'humans':
        return {
          modeData: humanData,
          isLoading: isLoadingHumanData,
          selectedItems: selectedHumans,
          onItemSelection: onHumanSelection,
          title: 'Select Human Voice Types'
        };
      case 'instruments':
        return {
          modeData: instrumentData,
          isLoading: isLoadingInstrumentData,
          selectedItems: selectedInstruments,
          onItemSelection: onInstrumentSelection,
          title: 'Select Instruments'
        };
      default:
        return null;
    }
  };

  const modePanelProps = getModePanelProps();

  return (
    <div className="equalizer-panel">
      <div className="panel-header">
        <h3>GRAPHIC EQUALIZER - {getModeTitle()}</h3>
        <div className="header-controls">
          <span className="processing-indicator">
            {isProcessing ? 'Processing...' : 'Ready'}
          </span>
          <span className="band-count">
            Bands: {frequencyBands.length}
          </span>
        </div>
      </div>
      
      {/* Mode Selection */}
      <div className="mode-selection">
        <div className="mode-buttons">
          <button 
            className={`mode-btn ${currentMode === 'generic' ? 'active' : ''}`}
            onClick={() => onModeChange('generic')}
          >
            Generic
          </button>
          <button 
            className={`mode-btn ${currentMode === 'animals' ? 'active' : ''}`}
            onClick={() => onModeChange('animals')}
            disabled={isLoadingAnimalData || !animalData}
          >
            {isLoadingAnimalData ? 'Loading...' : 'Animals'}
          </button>
          <button 
            className={`mode-btn ${currentMode === 'humans' ? 'active' : ''}`}
            onClick={() => onModeChange('humans')}
            disabled={isLoadingHumanData || !humanData}
          >
            {isLoadingHumanData ? 'Loading...' : 'Humans'}
          </button>
          <button 
            className={`mode-btn ${currentMode === 'instruments' ? 'active' : ''}`}
            onClick={() => onModeChange('instruments')}
            disabled={isLoadingInstrumentData || !instrumentData}
          >
            {isLoadingInstrumentData ? 'Loading...' : 'Instruments'}
          </button>
        </div>
      </div>

      {/* Mode-specific Selection Panel */}
      {modePanelProps && (
        <ModePanel {...modePanelProps} maxSelection={3} />
      )}

      {/* Audio Separation Section - Only show in Instruments mode */}
      {currentMode === 'instruments' && (
        <div className="audio-separation-section">
          <div className="separation-header">
            <h4>🎵 Instrument Separation</h4>
            <p>Separate music into individual instruments using AI</p>
          </div>
          
          <div className="separation-controls">
            <div className="file-input-container">
              <label className="file-input-label">Upload Music File (.wav):</label>
              <input
                type="file"
                accept=".wav"
                onChange={onSeparationUpload}
                className="file-input"
              />
            </div>
            
            <button
              onClick={onSeparateAudio}
              disabled={!separationFile || isSeparating}
              className="btn btn-separate"
            >
              {isSeparating ? '🎵 Separating...' : '🎵 Separate Instruments'}
            </button>
          </div>
          
          {separatedTracks.length > 0 && (
            <div className="separated-tracks">
              <h5>🎵 Separated Instruments:</h5>
              <div className="tracks-list">
                {separatedTracks.map((track, index) => (
                  <div key={index} className={`track-item ${playingSeparatedTrack === (track.name || track) ? 'playing' : ''}`}>
                    <span className="track-name">
                      🎵 {typeof track === 'string' ? track : track.name || 'Unknown Track'}
                    </span>
                    <button
                      onClick={() => onPlaySeparatedTrack(track)}
                      disabled={playingSeparatedTrack === (track.name || track)}
                      className="btn-play-track"
                    >
                      {playingSeparatedTrack === (track.name || track) ? '🔊 Playing...' : '▶ Play'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="control-buttons">
        {currentMode === 'generic' && (
          <button onClick={addBand} className="btn btn-add">
            + Add Band
          </button>
        )}
        <button onClick={onReset} className="btn btn-reset">
          {currentMode === 'generic' ? 'Reset Bands' : 'Reset Scales'}
        </button>
        <button onClick={onCustomizeSignal} className="btn btn-generate">
          Customize Signal
        </button>
        
        {/* File Upload Button */}
        <label className="btn btn-upload">
          Upload WAV
          <input
            type="file"
            accept=".wav"
            onChange={handleFileUpload}
            style={{ display: 'none' }}
          />
        </label>
        
        <button onClick={onSave} className="btn btn-save">
          Save
        </button>
      </div>

      {/* Processing Status */}
      {isProcessing && (
        <div className="processing-status">
          <div className="spinner"></div>
          <span>Processing audio...</span>
        </div>
      )}
    </div>
  );
};

export default EqualizerPanel;