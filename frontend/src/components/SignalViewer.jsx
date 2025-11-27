import React, { useEffect, useRef, useState } from 'react';
import { select, line, scaleLog, scaleLinear, axisBottom, axisLeft, max, curveBasis } from 'd3';
import './SignalViewer.css';

const API_BASE = 'http://localhost:5000/api';

const SignalViewer = ({ title, signal, timeAxis, color = '#3498DB', sampleRate = 44100, type = 'frequency' }) => {
  const svgRef = useRef();
  const [fftData, setFftData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  // Downsample data for better performance
  const downsampleData = (data, maxPoints = 1000) => {
    if (!data || data.length === 0) return data;
    
    if (data.length <= maxPoints) {
      return data;
    }

    const factor = Math.ceil(data.length / maxPoints);
    const downsampled = [];
    
    for (let i = 0; i < data.length; i += factor) {
      downsampled.push(data[i]);
    }
    
    return downsampled;
  };

  // Only fetch FFT data from backend for frequency domain
  useEffect(() => {
    if (type === 'frequency' && signal.length > 0) {
      fetchFFTData();
    } else {
      setFftData(null);
    }
  }, [signal, type, sampleRate]);

  const fetchFFTData = async () => {
    if (signal.length === 0) return;
    
    setIsLoading(true);
    try {
      const response = await fetch(`${API_BASE}/fft-spectrum`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          signal: signal,
          sample_rate: sampleRate 
        })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      if (data.success) {
        setFftData(data);
      }
    } catch (error) {
      console.error('Error fetching FFT data:', error);
      setFftData(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!signal || signal.length === 0) {
      const svg = select(svgRef.current);
      svg.selectAll("*").remove();
      
      // Show "No Data" message
      const margin = { top: 25, right: 15, bottom: 35, left: 40 };
      const width = 400 - margin.left - margin.right;
      const height = 200 - margin.top - margin.bottom;

      const g = svg.append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

      g.append("text")
        .attr("x", width / 2)
        .attr("y", height / 2)
        .attr("text-anchor", "middle")
        .style("fill", "#BDC3C7")
        .style("font-size", "12px")
        .text("No Signal Data");

      return;
    }

    const svg = select(svgRef.current);
    svg.selectAll("*").remove();

    const margin = { top: 25, right: 15, bottom: 35, left: 40 };
    const width = 400 - margin.left - margin.right;
    const height = 200 - margin.top - margin.bottom;

    const g = svg.append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    if (type === 'frequency') {
      if (!fftData || isLoading) {
        g.append("text")
          .attr("x", width / 2)
          .attr("y", height / 2)
          .attr("text-anchor", "middle")
          .style("fill", "#BDC3C7")
          .style("font-size", "12px")
          .text("Calculating FFT...");
        return;
      }

      // Filter valid data
      const validData = [];
      for (let i = 0; i < fftData.frequencies.length; i++) {
        const freq = fftData.frequencies[i];
        const mag = fftData.magnitude[i];
        if (freq > 0 && freq <= 20000 && !isNaN(mag) && isFinite(mag) && mag >= 0) {
          validData.push({ frequency: freq, magnitude: mag });
        }
      }

      if (validData.length === 0) {
        g.append("text")
          .attr("x", width / 2)
          .attr("y", height / 2)
          .attr("text-anchor", "middle")
          .style("fill", "#BDC3C7")
          .style("font-size", "12px")
          .text("No FFT data available");
        return;
      }

      const magnitudes = validData.map(d => d.magnitude);
      const frequencies = validData.map(d => d.frequency);

      const xScale = scaleLog()
        .domain([Math.max(20, Math.min(...frequencies)), Math.min(20000, Math.max(...frequencies))])
        .range([0, width])
        .clamp(true);

      const yScale = scaleLinear()
        .domain([0, max(magnitudes) * 1.1 || 0.1])
        .range([height, 0])
        .nice();

      const lineGenerator = line()
        .x((d, i) => xScale(frequencies[i]))
        .y(d => yScale(d))
        .curve(curveBasis);

      // Add the line
      g.append("path")
        .datum(magnitudes)
        .attr("class", "signal-line")
        .attr("fill", "none")
        .attr("stroke", color)
        .attr("stroke-width", 1.5)
        .attr("d", lineGenerator);

      // Add axes and grid
      g.append("g")
        .attr("transform", `translate(0,${height})`)
        .call(axisBottom(xScale).ticks(5, ".0s"))
        .append("text")
        .attr("x", width / 2)
        .attr("y", 28)
        .attr("fill", "#ecf0f1")
        .style("text-anchor", "middle")
        .style("font-size", "10px")
        .text("Frequency (Hz)");

      g.append("g")
        .call(axisLeft(yScale).ticks(4))
        .append("text")
        .attr("transform", "rotate(-90)")
        .attr("y", -28)
        .attr("x", -height / 2)
        .attr("fill", "#ecf0f1")
        .style("text-anchor", "middle")
        .style("font-size", "10px")
        .text("Amplitude");

    } else {
      // Time domain display - استخدام downsampling للأداء
      const displaySignal = downsampleData(signal, 1000);
      const displayTimeAxis = timeAxis && timeAxis.length === signal.length 
        ? downsampleData(timeAxis, 1000)
        : Array.from({ length: displaySignal.length }, (_, i) => i / sampleRate);

      const xScale = scaleLinear()
        .domain([0, displayTimeAxis[displayTimeAxis.length - 1] || 1])
        .range([0, width]);

      const yScale = scaleLinear()
        .domain([-1, 1])
        .range([height, 0]);

      const lineGenerator = line()
        .x((d, i) => xScale(displayTimeAxis[i]))
        .y(d => yScale(d))
        .curve(curveBasis);

      g.append("path")
        .datum(displaySignal)
        .attr("class", "signal-line")
        .attr("fill", "none")
        .attr("stroke", color)
        .attr("stroke-width", 1.2)
        .attr("d", lineGenerator);

      // Add axes and grid for time domain
      g.append("g")
        .attr("transform", `translate(0,${height})`)
        .call(axisBottom(xScale).ticks(5))
        .append("text")
        .attr("x", width / 2)
        .attr("y", 28)
        .attr("fill", "#ecf0f1")
        .style("text-anchor", "middle")
        .style("font-size", "10px")
        .text("Time (s)");

      g.append("g")
        .call(axisLeft(yScale).ticks(4))
        .append("text")
        .attr("transform", "rotate(-90)")
        .attr("y", -28)
        .attr("x", -height / 2)
        .attr("fill", "#ecf0f1")
        .style("text-anchor", "middle")
        .style("font-size", "10px")
        .text("Amplitude");
    }

    // Add title
    g.append("text")
      .attr("x", width / 2)
      .attr("y", -8)
      .attr("text-anchor", "middle")
      .style("font-size", "12px")
      .style("font-weight", "bold")
      .style("fill", "#ecf0f1")
      .text(title);

  }, [signal, timeAxis, title, color, sampleRate, type, fftData, isLoading]);

  return (
    <div className="signal-viewer">
      <div className="signal-info">
        <span>Points: {signal?.length || 0}</span>
        <span>Type: {type}</span>
      </div>
      <svg
        ref={svgRef}
        width={440}
        height={240}
      />
    </div>
  );
};

export default SignalViewer;