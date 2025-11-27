from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import JSONResponse, FileResponse
from spleeter.separator import Separator
import shutil
from pathlib import Path
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import numpy as np
import json
import os
import scipy.io.wavfile as wavfile
import io
import math

router = APIRouter(prefix="/api")

# Directory setup
BASE_DIR = Path(__file__).parent.parent.parent
OUTPUT_DIR = BASE_DIR / "output"
OUTPUT_DIR.mkdir(exist_ok=True)

print(f"Output directory: {OUTPUT_DIR}")

# Custom FFT Processor
class FFTProcessor:
    def __init__(self):
        self.nyquist_limit = 0

    def fft(self, x):
        """Cooley–Tukey FFT with automatic zero-padding."""
        n = len(x)
        if n <= 1:
            return x.astype(complex)

        # Zero-pad to next power of 2
        if (n & (n - 1)) != 0:
            next_pow = 2 ** math.ceil(math.log2(n))
            x = np.pad(x, (0, next_pow - n), mode="constant")
            n = next_pow

        return self.fft_iterative(x)

    def fft_iterative(self, x):
        """Iterative radix-2 FFT."""
        n = len(x)
        x = x.astype(complex)

        # Bit-reversal
        j = 0
        for i in range(1, n):
            bit = n >> 1
            while j & bit:
                j ^= bit
                bit >>= 1
            j ^= bit
            if i < j:
                x[i], x[j] = x[j], x[i]

        # Butterfly stages
        length = 2
        while length <= n:
            half = length // 2
            w = np.exp(-2j * np.pi * np.arange(half) / length)
            for start in range(0, n, length):
                for k in range(half):
                    u = x[start + k]
                    v = w[k] * x[start + k + half]
                    x[start + k] = u + v
                    x[start + k + half] = u - v
            length <<= 1

        return x

    def ifft(self, X):
        """Inverse FFT using conjugate symmetry."""
        X = np.asarray(X, dtype=complex)
        n = len(X)
        return np.real(self.fft(np.conjugate(X)).conjugate() / n)

    def compute_fft_spectrum(self, signal, sample_rate, target_length=1024):
        try:
            signal = np.array(signal, dtype=np.float64)

            # Remove DC
            signal = signal - np.mean(signal)

            # Windowing
            signal *= np.hanning(len(signal))

            # Downsample for visualization
            if len(signal) > target_length:
                step = max(1, len(signal) // target_length)
                signal = signal[::step]

            if len(signal) == 0:
                return {"magnitude": [], "frequencies": []}

            # Apply FFT (custom FFT)
            fft_result = self.fft(signal)
            n = len(fft_result)

            # Positive frequencies only
            mag = np.abs(fft_result[:n // 2]) / (len(signal))
            freqs = np.array([(k * sample_rate) / n for k in range(n // 2)])

            # Only 0 < f <= Nyquist
            valid = (freqs > 0) & (freqs <= sample_rate / 2)
            mag = mag[valid]
            freqs = freqs[valid]

            # Convert to dB scale
            mag = 20 * np.log10(mag + 1e-12)
            mag = np.clip(mag, -80, 0)
            mag = (mag + 80) / 80

            return {"magnitude": mag.tolist(), "frequencies": freqs.tolist()}

        except Exception as e:
            print("Error in compute_fft_spectrum:", e)
            return {"magnitude": [], "frequencies": []}

    def compute_spectrogram(self, signal, sample_rate, n_fft=1024, hop_length=None):
        """Spectrogram using custom FFT implementation."""
        try:
            signal = np.array(signal, dtype=float)
            hop = hop_length or n_fft // 2

            # Pad so last frame fits
            pad = (n_fft - (len(signal) % hop)) % hop
            signal = np.pad(signal, (0, pad), mode="constant")

            frames = []
            for start in range(0, len(signal) - n_fft + 1, hop):
                frame = signal[start:start + n_fft]
                frame *= np.hanning(n_fft)

                fft_frame = self.fft(frame)[:n_fft // 2]
                mag = np.abs(fft_frame)

                frames.append(mag.tolist())

            return frames

        except Exception as e:
            print("Error in compute_spectrogram:", e)
            return []

    def normalize_spectrogram(self, spectrogram):
        spec = np.array(spectrogram)
        spec = spec - spec.min()
        maxv = spec.max()
        if maxv > 0:
            spec = spec / maxv
        return spec.tolist()

    def get_frequency_bins(self, signal_length, sample_rate):
        n = signal_length
        return np.array([(k * sample_rate) / n for k in range(n // 2)])

# Custom Equalizer using custom FFT
class Equalizer:
    def __init__(self, fft_processor):
        self.fft_processor = fft_processor
        self.sample_rate = 44100
    
    def apply_equalizer(self, signal, frequency_bands, sample_rate=44100):
        """
        Apply equalizer using custom FFT implementation
        """
        try:
            signal = np.array(signal, dtype=np.float64)
            original_length = len(signal)
            
            print(f"Equalizer processing - Signal length: {original_length}, RMS: {np.sqrt(np.mean(signal**2)):.6f}")
            
            # Apply windowing for better frequency analysis
            window = np.hanning(original_length)
            windowed_signal = signal * window
            
            # Compute FFT using custom FFT
            freq_domain = self.fft_processor.fft(windowed_signal)
            n = len(freq_domain)
            
            # Create frequency array manually (no np.fft.fftfreq)
            freqs = np.array([i / n * sample_rate if i < n/2 else (i - n) / n * sample_rate for i in range(n)])
            
            # Create output frequency domain
            output_freq = freq_domain.copy()
            
            # Track if any bands actually modify the signal
            bands_applied = 0
            
            # Apply frequency band adjustments
            for band in frequency_bands:
                low_freq = band['low_freq']
                high_freq = band['high_freq']
                scale = band['scale']
                
                if scale == 1.0:
                    continue
                    
                bands_applied += 1
                    
                # Apply to positive frequencies
                pos_mask = (freqs >= low_freq) & (freqs <= high_freq) & (freqs >= 0)
                output_freq[pos_mask] = freq_domain[pos_mask] * scale
                
                # Apply to negative frequencies (symmetric)
                neg_mask = (freqs <= -low_freq) & (freqs >= -high_freq) & (freqs < 0)
                output_freq[neg_mask] = freq_domain[neg_mask] * scale
            
            print(f"Bands applied: {bands_applied}")
            
            # Only do IFFT if bands were actually applied
            if bands_applied > 0:
                processed_signal = self.fft_processor.ifft(output_freq)
                processed_signal = np.real(processed_signal)
                
                # Compensate for windowing
                processed_signal = processed_signal / window
                # Remove any infinities from division
                processed_signal = np.nan_to_num(processed_signal, nan=0.0, posinf=0.0, neginf=0.0)
            else:
                processed_signal = signal.copy()
            
            # Ensure proper length
            if len(processed_signal) > original_length:
                processed_signal = processed_signal[:original_length]
            elif len(processed_signal) < original_length:
                processed_signal = np.pad(processed_signal, (0, original_length - len(processed_signal)))
            
            # Preserve original signal level
            original_rms = np.sqrt(np.mean(signal**2))
            processed_rms = np.sqrt(np.mean(processed_signal**2))
            
            if processed_rms > 0 and original_rms > 0:
                level_ratio = original_rms / processed_rms
                if 0.1 < level_ratio < 10:
                    processed_signal = processed_signal * level_ratio
            
            # Gentle limiting
            max_val = np.max(np.abs(processed_signal))
            if max_val > 0.95:
                processed_signal = np.tanh(processed_signal * 0.9) * 0.95
            
            final_rms = np.sqrt(np.mean(processed_signal**2))
            print(f"Equalizer complete - Output RMS: {final_rms:.6f}, Max: {np.max(np.abs(processed_signal)):.6f}")
            
            return processed_signal.astype(np.float32)
            
        except Exception as e:
            print(f"Error in equalizer: {e}")
            import traceback
            traceback.print_exc()
            return signal.astype(np.float32)
    
    def get_frequency_response(self, frequency_bands, sample_rate=44100, n_points=1024):
        freqs = np.linspace(20, 20000, n_points)
        response = np.ones_like(freqs)
        for band in frequency_bands:
            mask = (freqs >= band['low_freq']) & (freqs <= band['high_freq'])
            response[mask] = band['scale']
        return {'frequencies': freqs.tolist(), 'magnitude': response.tolist()}
    
    def create_default_bands(self, num_bands=10, min_freq=20, max_freq=20000):
        min_log, max_log = np.log10(min_freq), np.log10(max_freq)
        log_freqs = np.logspace(min_log, max_log, num_bands + 1)
        bands = []
        for i in range(num_bands):
            bands.append({
                'id': i+1,
                'low_freq': log_freqs[i],
                'high_freq': log_freqs[i+1],
                'scale': 1.0,
                'label': f"{int(log_freqs[i])}-{int(log_freqs[i+1])}Hz",
                'center_freq': np.sqrt(log_freqs[i]*log_freqs[i+1])
            })
        return bands

class SignalGenerator:
    def generate_synthetic_signal(self, frequencies, duration, sample_rate):
        t = np.linspace(0, duration, int(sample_rate * duration))
        signal = np.zeros_like(t)
        for freq in frequencies:
            signal += np.sin(2 * np.pi * freq * t)
        return signal.tolist(), t.tolist()

# Initialize processors with custom FFT
fft_processor = FFTProcessor()
equalizer = Equalizer(fft_processor)
signal_generator = SignalGenerator()

# Pydantic models (unchanged)
class FrequencyBand(BaseModel):
    low_freq: float
    high_freq: float
    scale: float
    label: Optional[str] = None
    id: Optional[int] = None

class ProcessRequest(BaseModel):
    signal: List[float]
    frequency_bands: List[FrequencyBand]
    sample_rate: int = 44100

class SpectrogramRequest(BaseModel):
    signal: List[float]
    sample_rate: int = 44100

class SyntheticSignalRequest(BaseModel):
    frequencies: List[float] = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]
    duration: float = 3.0
    sample_rate: int = 44100

class SaveSettingsRequest(BaseModel):
    settings: Dict[str, Any]
    filename: str = "equalizer_settings.json"

class LoadSettingsRequest(BaseModel):
    filename: str = "equalizer_settings.json"

# Routes (updated to use custom FFT)
@router.get("/ping")
def ping():
    return {"status": "ok", "message": "Backend API reachable!"}

@router.get("/health")
def health_check():
    return {"status": "healthy", "message": "Signal Equalizer API is running"}

@router.post("/process")
async def process_signal(request: ProcessRequest):
    try:
        print(f"Processing signal - Length: {len(request.signal)}, Bands: {len(request.frequency_bands)}")
        
        signal = np.array(request.signal, dtype=np.float32)
        frequency_bands = [band.dict() for band in request.frequency_bands]
        
        # Limit signal length for performance
        max_length = 44100 * 10  # 10 seconds max
        if len(signal) > max_length:
            signal = signal[:max_length]
            print(f"Signal truncated to {max_length} samples for performance")
        
        signal_rms = np.sqrt(np.mean(signal**2)) if len(signal) > 0 else 0
        
        processed_signal_list = equalizer.apply_equalizer(signal, frequency_bands, request.sample_rate)
        
        processed_signal_np = np.array(processed_signal_list, dtype=np.float32)
        processed_rms = np.sqrt(np.mean(processed_signal_np**2)) if len(processed_signal_np) > 0 else 0
        
        spectrogram_processed = fft_processor.compute_spectrogram(processed_signal_np, request.sample_rate)

        return {
            'success': True,
            'processed_signal': processed_signal_list,
            'spectrogram_processed': spectrogram_processed,
            'sample_rate': request.sample_rate,
            'signal_stats': {
                'input_rms': float(signal_rms),
                'output_rms': float(processed_rms)
            }
        }
    except Exception as e:
        print(f"Error in process_signal: {e}")
        import traceback
        traceback.print_exc()
        return JSONResponse(
            status_code=500,
            content={'success': False, 'error': str(e)}
        )

@router.post("/spectrogram")
async def get_spectrogram(request: SpectrogramRequest):
    try:
        signal = np.array(request.signal)
        
        # Limit signal length for performance
        max_length = 44100 * 10  # 10 seconds max
        if len(signal) > max_length:
            signal = signal[:max_length]
        
        spectrogram = fft_processor.compute_spectrogram(signal, request.sample_rate)
        
        if spectrogram and len(spectrogram) > 0:
            return {
                'success': True,
                'spectrogram': spectrogram,
                'sample_rate': request.sample_rate
            }
        else:
            return {
                'success': False,
                'error': 'Spectrogram computation returned empty result',
                'spectrogram': []
            }
    except Exception as e:
        print(f"Spectrogram error: {str(e)}")
        return {
            'success': False,
            'error': str(e),
            'spectrogram': []
        }

@router.post("/fft-spectrum")
async def get_fft_spectrum(request: SpectrogramRequest):
    try:
        signal = np.array(request.signal)
        
        # Limit signal length for performance
        max_length = 44100 * 5  # 5 seconds max for FFT
        if len(signal) > max_length:
            signal = signal[:max_length]
        
        spectrum_data = fft_processor.compute_fft_spectrum(signal, request.sample_rate)
        return {
            'success': True,
            'magnitude': spectrum_data['magnitude'],
            'frequencies': spectrum_data['frequencies'],
            'sample_rate': request.sample_rate
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/synthetic-signal")
async def generate_synthetic_signal(request: SyntheticSignalRequest):
    try:
        # Limit duration for performance
        max_duration = 10.0
        duration = min(request.duration, max_duration)
        
        signal, time_axis = signal_generator.generate_synthetic_signal(
            request.frequencies, duration, request.sample_rate
        )
        return {
            'success': True,
            'signal': signal,
            'time_axis': time_axis,
            'frequencies': request.frequencies,
            'sample_rate': request.sample_rate,
            'duration': duration
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/upload-audio")
async def upload_audio(file: UploadFile = File(...)):
    try:
        if not file.filename.lower().endswith('.wav'):
            return {'success': False, 'error': 'Only WAV files are supported'}
        
        contents = await file.read()
        sample_rate, audio_data = wavfile.read(io.BytesIO(contents))
        
        if len(audio_data.shape) > 1:
            audio_data = np.mean(audio_data, axis=1)
        
        if audio_data.dtype == np.int16:
            audio_data = audio_data.astype(np.float32) / 32768.0
        elif audio_data.dtype == np.int32:
            audio_data = audio_data.astype(np.float32) / 2147483648.0
        elif audio_data.dtype == np.uint8:
            audio_data = (audio_data.astype(np.float32) - 128) / 128.0
        
        audio_data = audio_data - np.mean(audio_data)
        max_val = np.max(np.abs(audio_data))
        if max_val > 0:
            audio_data = audio_data * (0.9 / max_val)
        
        max_duration = 30
        max_samples = sample_rate * max_duration
        if len(audio_data) > max_samples:
            audio_data = audio_data[:max_samples]
        
        time_axis = np.linspace(0, len(audio_data) / sample_rate, len(audio_data))
        
        return {
            'success': True,
            'signal': audio_data.tolist(),
            'time_axis': time_axis.tolist(),
            'sample_rate': sample_rate,
            'duration': len(audio_data) / sample_rate,
            'filename': file.filename
        }
    except Exception as e:
        print(f"Error processing audio file: {e}")
        return {'success': False, 'error': f'Error processing audio file: {str(e)}'}

@router.post("/frequency-response")
async def get_frequency_response(request: ProcessRequest):
    try:
        frequency_bands = [band.dict() for band in request.frequency_bands]
        response = equalizer.get_frequency_response(frequency_bands, request.sample_rate)
        
        if not response or 'frequencies' not in response or 'magnitude' not in response:
            return {'success': False, 'error': 'Invalid frequency response data'}
            
        return {
            'success': True, 
            'frequency_response': {
                'frequencies': response['frequencies'],
                'response': response['magnitude']
            }
        }
    except Exception as e:
        print(f"Error in get_frequency_response: {e}")
        return JSONResponse(
            status_code=500,
            content={'success': False, 'error': str(e)}
        )

@router.get("/default-bands")
async def get_default_bands():
    try:
        bands = equalizer.create_default_bands(num_bands=10)
        return {'success': True, 'bands': bands}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/separate")
async def separate_audio(file: UploadFile = File(...)):
    try:
        temp_dir = BASE_DIR / "temp"
        temp_dir.mkdir(exist_ok=True)
        
        input_path = temp_dir / file.filename
        
        with open(input_path, "wb") as f:
            shutil.copyfileobj(file.file, f)
        
        print(f"Starting audio separation for file: {file.filename}")
        
        separator = Separator("spleeter:5stems")
        separator.separate_to_file(str(input_path), str(OUTPUT_DIR))
        
        result_folder = OUTPUT_DIR / Path(file.filename).stem
        files = []
        
        if result_folder.exists():
            for f in result_folder.glob("*.wav"):
                relative_path = f.relative_to(OUTPUT_DIR)
                files.append({
                    "name": f.name,
                    "path": str(relative_path).replace("\\", "/")
                })
            print(f"Separation completed. Generated {len(files)} files")
        
        try:
            os.remove(input_path)
        except:
            pass
        
        return JSONResponse({
            "success": True,
            "output_files": files, 
            "output_path": str(result_folder.relative_to(OUTPUT_DIR)).replace("\\", "/")
        })
        
    except Exception as e:
        print(f"Error in audio separation: {e}")
        return JSONResponse({
            "success": False,
            "error": str(e)
        }, status_code=500)

@router.get("/download/{file_path:path}")
async def download_file(file_path: str):
    try:
        file_full_path = OUTPUT_DIR / file_path
        
        if file_full_path.exists() and file_full_path.is_file():
            return FileResponse(
                path=file_full_path, 
                filename=file_full_path.name,
                media_type='audio/wav'
            )
        else:
            raise HTTPException(status_code=404, detail="File not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))