import React, { useEffect, useRef } from 'react';
import './Spectrogram.css';

const Spectrogram = React.memo(({ title, spectrogramData, sampleRate = 44100, signalLength = 0 })  => {
  const canvasRef = useRef();

  useEffect(() => {
    console.log(`Spectrogram ${title} rendering:`, {
      hasData: !!spectrogramData,
      isArray: Array.isArray(spectrogramData),
      rows: spectrogramData?.length,
      cols: spectrogramData?.[0]?.length
    });

    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');

    // Set canvas dimensions
    const width = 600;
    const height = 400;
    
    canvas.width = width;
    canvas.height = height;

    // Clear canvas
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, width, height);

    if (!spectrogramData || !Array.isArray(spectrogramData) || spectrogramData.length === 0) {
      console.log('No spectrogram data available for:', title);
      
      // Show "No Data" message
      ctx.fillStyle = '#ecf0f1';
      ctx.font = '16px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('No Spectrogram Data Available', width / 2, height / 2);
      ctx.fillText(title, width / 2, height / 2 + 30);
      return;
    }

    const rows = spectrogramData.length;
    const cols = spectrogramData[0].length;

    if (rows === 0 || cols === 0) {
      ctx.fillStyle = '#ecf0f1';
      ctx.font = '16px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('Empty Spectrogram Data', width / 2, height / 2);
      return;
    }

    // Calculate time and frequency information
    const duration = signalLength / sampleRate;
    const maxFrequency = sampleRate / 2; // Nyquist frequency

    console.log(`Rendering ${title}: ${rows}x${cols}, duration: ${duration}s, maxFreq: ${maxFrequency}Hz`);

    // Draw the spectrogram
    const cellWidth = width / cols;
    const cellHeight = height / rows;

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        let value = spectrogramData[y][x];

        // Ensure value is in valid range
        if (value == null || isNaN(value)) {
          value = 0;
        }
        value = Math.max(0, Math.min(1, value));

        // Color mapping based on value
        let r, g, b;
        
        if (title.includes('Difference')) {
          // Difference spectrogram: blue for negative, red for positive
          if (value < 0.5) {
            // Blue scale for negative values
            const intensity = (0.5 - value) * 2;
            r = Math.floor(50);
            g = Math.floor(100 + intensity * 100);
            b = Math.floor(200 + intensity * 55);
          } else {
            // Red scale for positive values
            const intensity = (value - 0.5) * 2;
            r = Math.floor(200 + intensity * 55);
            g = Math.floor(100 + intensity * 100);
            b = Math.floor(50);
          }
        } else {
          // Normal spectrogram: grey -> pink -> red
          if (value < 0.3) {
            // Grey scale for low values
            const intensity = value / 0.3;
            r = g = b = Math.floor(80 + intensity * 100);
          } else if (value < 0.7) {
            // Pink scale for medium values
            const intensity = (value - 0.3) / 0.4;
            r = Math.floor(180 + intensity * 75);
            g = Math.floor(100 + intensity * 50);
            b = Math.floor(150 + intensity * 50);
          } else {
            // Red scale for high values
            const intensity = (value - 0.7) / 0.3;
            r = 255;
            g = Math.floor(150 - intensity * 100);
            b = Math.floor(200 - intensity * 150);
          }
        }

        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.fillRect(x * cellWidth, (rows - y - 1) * cellHeight, cellWidth, cellHeight);
      }
    }

    // Draw axes and labels
    ctx.strokeStyle = '#ecf0f1';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, width, height);

    // Draw title
    ctx.fillStyle = '#ecf0f1';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(title, 10, 20);

    // Draw frequency axis (Y-axis)
    ctx.textAlign = 'right';
    ctx.font = '10px Arial';
    
    // Frequency labels (Hz)
    const freqLabels = [
      { freq: 0, label: '0 Hz' },
      { freq: maxFrequency * 0.25, label: `${Math.round(maxFrequency * 0.25 / 1000)}k` },
      { freq: maxFrequency * 0.5, label: `${Math.round(maxFrequency * 0.5 / 1000)}k` },
      { freq: maxFrequency * 0.75, label: `${Math.round(maxFrequency * 0.75 / 1000)}k` },
      { freq: maxFrequency, label: `${Math.round(maxFrequency / 1000)}k Hz` }
    ];

    freqLabels.forEach(({ freq, label }) => {
      const yPos = height - (freq / maxFrequency) * height;
      ctx.fillText(label, 45, yPos - 5);
    });

    // Draw time axis (X-axis) if we have duration information
    if (duration > 0) {
      ctx.textAlign = 'center';
      const timeLabels = [
        { time: 0, label: '0s' },
        { time: duration * 0.25, label: `${(duration * 0.25).toFixed(1)}s` },
        { time: duration * 0.5, label: `${(duration * 0.5).toFixed(1)}s` },
        { time: duration * 0.75, label: `${(duration * 0.75).toFixed(1)}s` },
        { time: duration, label: `${duration.toFixed(1)}s` }
      ];

      timeLabels.forEach(({ time, label }) => {
        const xPos = (time / duration) * width;
        ctx.fillText(label, xPos, height - 5);
      });
    }

    // Draw axis titles
    ctx.save();
    ctx.translate(15, height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText('Frequency (Hz)', 0, 0);
    ctx.restore();

    if (duration > 0) {
      ctx.textAlign = 'center';
      ctx.fillText('Time (seconds)', width / 2, height - 15);
    }

  }, [spectrogramData, title, sampleRate, signalLength]);

  return (
    <div className="spectrogram-container">
      <canvas
        ref={canvasRef}
        style={{ 
          border: '1px solid #34495E', 
          borderRadius: '4px',
          background: '#1a1a2e'
        }}
      />
    </div>
  );
});

export default Spectrogram;