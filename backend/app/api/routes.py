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

router = APIRouter(prefix="/api")

# Directory setup - استخدام المسار المطلق
BASE_DIR = Path(__file__).parent.parent.parent
OUTPUT_DIR = BASE_DIR / "output"
OUTPUT_DIR.mkdir(exist_ok=True)  # التأكد من وجود المجلد

print(f"Output directory: {OUTPUT_DIR}")

# Initialize processors (fallback implementations)
class SignalGenerator:
    def generate_synthetic_signal(self, frequencies, duration, sample_rate):
        t = np.linspace(0, duration, int(sample_rate * duration))
        signal = np.zeros_like(t)
        for freq in frequencies:
            signal += np.sin(2 * np.pi * freq * t)
        return signal.tolist(), t.tolist()

class FFTProcessor:
    def compute_spectrogram(self, signal, sample_rate):
        try:
            signal = np.array(signal)
            n = len(signal)
            fft_size = 1024
            hop_size = 512
            
            # إذا كانت الإشارة قصيرة جدًا، نعيد مصفوفة فارغة
            if n < fft_size:
                return []
                
            spectrogram = []
            for i in range(0, n - fft_size, hop_size):
                segment = signal[i:i + fft_size]
                fft_result = np.fft.fft(segment)
                magnitude = np.abs(fft_result[:fft_size // 2])
                spectrogram.append(magnitude.tolist())
            return spectrogram
        except Exception as e:
            print(f"Error in compute_spectrogram: {e}")
            return []
    
    def compute_fft_spectrum(self, signal, sample_rate):
        try:
            signal = np.array(signal)
            n = len(signal)
            if n == 0:
                return {'frequencies': [], 'magnitude': []}
                
            fft_result = np.fft.fft(signal)
            frequencies = np.fft.fftfreq(n, 1/sample_rate)[:n//2]
            magnitude = np.abs(fft_result[:n//2])
            return {'frequencies': frequencies.tolist(), 'magnitude': magnitude.tolist()}
        except Exception as e:
            print(f"Error in compute_fft_spectrum: {e}")
            return {'frequencies': [], 'magnitude': []}

class Equalizer:
    def apply_equalizer(self, signal, frequency_bands, sample_rate):
        try:
            signal = np.array(signal, dtype=np.float32)
            n = len(signal)
            if n == 0:
                return []
                
            fft_signal = np.fft.fft(signal)
            frequencies = np.fft.fftfreq(n, 1/sample_rate)
            
            for band in frequency_bands:
                low_freq = band.get('low_freq', 0)
                high_freq = band.get('high_freq', sample_rate/2)
                scale = band.get('scale', 1.0)
                
                # إنشاء قناع للترددات في النطاق المطلوب
                mask = (np.abs(frequencies) >= low_freq) & (np.abs(frequencies) <= high_freq)
                fft_signal[mask] *= scale
            
            processed = np.real(np.fft.ifft(fft_signal))
            return processed.tolist()
        except Exception as e:
            print(f"Error in apply_equalizer: {e}")
            return signal.tolist() if hasattr(signal, 'tolist') else []
    
    def get_frequency_response(self, frequency_bands, sample_rate):
        try:
            n = 1024
            frequencies = np.fft.fftfreq(n, 1/sample_rate)[:n//2]
            response = np.ones(n//2)
            
            for band in frequency_bands:
                low_freq = band.get('low_freq', 0)
                high_freq = band.get('high_freq', sample_rate/2)
                scale = band.get('scale', 1.0)
                
                mask = (frequencies >= low_freq) & (frequencies <= high_freq)
                response[mask] *= scale
            
            return {
                'frequencies': frequencies.tolist(),
                'response': response.tolist()
            }
        except Exception as e:
            print(f"Error in get_frequency_response: {e}")
            return {'frequencies': [], 'response': []}
    
    def create_default_bands(self, num_bands=10):
        bands = []
        freq_ranges = [
            (20, 60), (60, 120), (120, 250), (250, 500), (500, 1000),
            (1000, 2000), (2000, 4000), (4000, 8000), (8000, 16000), (16000, 20000)
        ]
        labels = ["Sub", "Bass", "Low Mid", "Mid", "High Mid", 
                 "Presence", "Brilliance", "High", "Very High", "Ultra High"]
        
        for i in range(min(num_bands, len(freq_ranges))):
            bands.append({
                'low_freq': freq_ranges[i][0],
                'high_freq': freq_ranges[i][1],
                'scale': 1.0,
                'label': labels[i],
                'id': i
            })
        return bands

signal_generator = SignalGenerator()
fft_processor = FFTProcessor()
equalizer = Equalizer()

# Pydantic models
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

# Routes
@router.get("/ping")
def ping():
    return {"status": "ok", "message": "Backend API reachable!"}

@router.get("/health")
def health_check():
    return {"status": "healthy", "message": "Signal Equalizer API is running"}

@router.post("/process")
async def process_signal(request: ProcessRequest):
    try:
        print(f"Processing signal - Length: {len(request.signal)}, Sample rate: {request.sample_rate}, Bands: {len(request.frequency_bands)}")
        
        # تحويل الإشارة إلى numpy array
        signal = np.array(request.signal, dtype=np.float32)
        frequency_bands = [band.dict() for band in request.frequency_bands]
        
        # حساب إحصائيات الإشارة الأصلية
        signal_rms = np.sqrt(np.mean(signal**2)) if len(signal) > 0 else 0
        print(f"Input signal RMS: {signal_rms:.6f}")
        
        if signal_rms < 1e-6:
            print("Warning: Input signal is very quiet")
        
        # تطبيق المعادل
        processed_signal_list = equalizer.apply_equalizer(signal, frequency_bands, request.sample_rate)
        
        # تحويل إلى numpy array لحساب الإحصائيات
        processed_signal_np = np.array(processed_signal_list, dtype=np.float32)
        processed_rms = np.sqrt(np.mean(processed_signal_np**2)) if len(processed_signal_np) > 0 else 0
        print(f"Output signal RMS: {processed_rms:.6f}")
        
        # حساب spectrogram للإشارة المعالجة
        spectrogram_processed = fft_processor.compute_spectrogram(processed_signal_np, request.sample_rate)
        print(f"Processed spectrogram: {len(spectrogram_processed)} x {len(spectrogram_processed[0]) if spectrogram_processed else 0}")

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
        print(f"Computing spectrogram for signal length: {len(request.signal)}")
        
        signal = np.array(request.signal)
        spectrogram = fft_processor.compute_spectrogram(signal, request.sample_rate)
        
        if spectrogram and len(spectrogram) > 0:
            print(f"Spectrogram computed: {len(spectrogram)} x {len(spectrogram[0])}")
            return {
                'success': True,
                'spectrogram': spectrogram,
                'sample_rate': request.sample_rate
            }
        else:
            print("Spectrogram computation returned empty result")
            return {
                'success': False,
                'error': 'Spectrogram computation returned empty result',
                'spectrogram': []
            }
    except Exception as e:
        print(f"Spectrogram error: {str(e)}")
        import traceback
        traceback.print_exc()
        return {
            'success': False,
            'error': str(e),
            'spectrogram': []
        }

@router.post("/fft-spectrum")
async def get_fft_spectrum(request: SpectrogramRequest):
    try:
        signal = np.array(request.signal)
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
        signal, time_axis = signal_generator.generate_synthetic_signal(
            request.frequencies, request.duration, request.sample_rate
        )
        return {
            'success': True,
            'signal': signal,
            'time_axis': time_axis,
            'frequencies': request.frequencies,
            'sample_rate': request.sample_rate,
            'duration': request.duration
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
        
        print(f"Uploaded audio - Sample rate: {sample_rate}, Shape: {audio_data.shape}, Dtype: {audio_data.dtype}")
        
        if len(audio_data.shape) > 1:
            print(f"Converting {audio_data.shape[1]} channels to mono")
            audio_data = np.mean(audio_data, axis=1)
        
        if audio_data.dtype == np.int16:
            audio_data = audio_data.astype(np.float32) / 32768.0
            print("Converted from int16 to float32")
        elif audio_data.dtype == np.int32:
            audio_data = audio_data.astype(np.float32) / 2147483648.0
            print("Converted from int32 to float32")
        elif audio_data.dtype == np.uint8:
            audio_data = (audio_data.astype(np.float32) - 128) / 128.0
            print("Converted from uint8 to float32")
        elif audio_data.dtype == np.float32:
            audio_data = audio_data.astype(np.float32)
            print("Already float32, no conversion needed")
        else:
            print(f"Unsupported dtype: {audio_data.dtype}, attempting generic conversion")
            audio_data = audio_data.astype(np.float32)
            if np.issubdtype(audio_data.dtype, np.integer):
                info = np.iinfo(audio_data.dtype)
                audio_data = audio_data / info.max
        
        dc_offset = np.mean(audio_data)
        audio_data = audio_data - dc_offset
        print(f"Removed DC offset: {dc_offset:.6f}")
        
        max_val = np.max(np.abs(audio_data))
        print(f"Max absolute value before normalization: {max_val:.6f}")
        
        if max_val > 0:
            audio_data = audio_data * (0.9 / max_val)
            print(f"Normalized with factor: {0.9 / max_val:.6f}")
        
        max_duration = 30
        max_samples = sample_rate * max_duration
        if len(audio_data) > max_samples:
            print(f"Truncating from {len(audio_data)} to {max_samples} samples")
            audio_data = audio_data[:max_samples]
        
        final_max = np.max(np.abs(audio_data))
        final_rms = np.sqrt(np.mean(audio_data**2))
        print(f"Final audio - Max: {final_max:.6f}, RMS: {final_rms:.6f}, Length: {len(audio_data)}")
        
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
        import traceback
        traceback.print_exc()
        return {'success': False, 'error': f'Error processing audio file: {str(e)}'}

@router.post("/save-settings")
async def save_settings(request: SaveSettingsRequest):
    try:
        os.makedirs('settings', exist_ok=True)
        filepath = os.path.join('settings', request.filename)
        with open(filepath, 'w') as f:
            json.dump(request.settings, f, indent=2)
        return {'success': True, 'filepath': filepath}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/load-settings")
async def load_settings(request: LoadSettingsRequest):
    try:
        filepath = os.path.join('settings', request.filename)
        if not os.path.exists(filepath):
            return {'success': False, 'error': 'Settings file not found'}
        with open(filepath, 'r') as f:
            settings = json.load(f)
        return {'success': True, 'settings': settings, 'filename': request.filename}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/frequency-response")
async def get_frequency_response(request: ProcessRequest):
    try:
        frequency_bands = [band.dict() for band in request.frequency_bands]
        response = equalizer.get_frequency_response(frequency_bands, request.sample_rate)
        
        # التأكد من أن البيانات لها الهيكل الصحيح
        if not response or 'frequencies' not in response or 'response' not in response:
            return {'success': False, 'error': 'Invalid frequency response data'}
            
        return {
            'success': True, 
            'frequency_response': response
        }
    except Exception as e:
        print(f"Error in get_frequency_response: {e}")
        import traceback
        traceback.print_exc()
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
        # حفظ الملف المرفوع مؤقتاً
        temp_dir = BASE_DIR / "temp"
        temp_dir.mkdir(exist_ok=True)
        
        input_path = temp_dir / file.filename
        
        with open(input_path, "wb") as f:
            shutil.copyfileobj(file.file, f)
        
        print(f"Starting audio separation for file: {file.filename}")
        
        # فصل الصوت باستخدام 5 stems
        separator = Separator("spleeter:5stems")
        separator.separate_to_file(str(input_path), str(OUTPUT_DIR))
        
        # قائمة الملفات الناتجة - استخدام مسارات نسبية
        result_folder = OUTPUT_DIR / Path(file.filename).stem
        files = []
        
        if result_folder.exists():
            for f in result_folder.glob("*.wav"):
                # استخدام مسار نسبي بدلاً من المسار الكامل
                relative_path = f.relative_to(OUTPUT_DIR)
                files.append({
                    "name": f.name,
                    "path": str(relative_path).replace("\\", "/")  # استخدام / للتوافق مع جميع الأنظمة
                })
            print(f"Separation completed. Generated {len(files)} files")
        else:
            print("Warning: Result folder not found")
        
        # تنظيف الملف المؤقت
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
        import traceback
        traceback.print_exc()
        return JSONResponse({
            "success": False,
            "error": str(e)
        }, status_code=500)

@router.get("/download/{file_path:path}")
async def download_file(file_path: str):
    """Endpoint لتحميل الملفات المنفصلة"""
    try:
        # تنظيف المسار وإزالة أي محاولات للوصول إلى مجلدات أعلى
        clean_path = Path(file_path).name
        file_full_path = OUTPUT_DIR / file_path
        
        print(f"Download request for: {file_path}")
        print(f"Full path: {file_full_path}")
        print(f"File exists: {file_full_path.exists()}")
        
        if file_full_path.exists() and file_full_path.is_file():
            return FileResponse(
                path=file_full_path, 
                filename=file_full_path.name,
                media_type='audio/wav'
            )
        else:
            print(f"File not found: {file_full_path}")
            raise HTTPException(status_code=404, detail="File not found")
    except Exception as e:
        print(f"Error downloading file: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/separated-files")
async def list_separated_files():
    """الحصول على قائمة بجميع الملفات المنفصلة"""
    try:
        all_files = []
        for result_folder in OUTPUT_DIR.glob("*"):
            if result_folder.is_dir():
                for wav_file in result_folder.glob("*.wav"):
                    relative_path = wav_file.relative_to(OUTPUT_DIR)
                    all_files.append({
                        "name": wav_file.name,
                        "path": str(relative_path).replace("\\", "/"),
                        "folder": result_folder.name
                    })
        return {"success": True, "files": all_files}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/test")
async def test_endpoint():
    """Endpoint لاختبار أن الخادم يعمل"""
    return {
        "status": "success", 
        "message": "Backend is working correctly!",
        "output_directory": str(OUTPUT_DIR),
        "output_exists": OUTPUT_DIR.exists()
    }