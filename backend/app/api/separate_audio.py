from spleeter.separator import Separator
from pathlib import Path
import os

# المسارات - بديل باستخدام os.path.join
base_dir = r"F:\Task3 DSP\Signal_Equalizer_Task3"
input_file = os.path.join(base_dir, "piano_flute_drumroll.wav")
output_dir = os.path.join(base_dir, "output")

# التأكد من وجود الملف
if not os.path.exists(input_file):
    print(f"خطأ: الملف {input_file} غير موجود!")
    exit()

# إنشاء مجلد الإخراج إذا لم يكن موجودًا
os.makedirs(output_dir, exist_ok=True)

print("جارِ فصل الصوت...")

try:
    # استخدام النموذج
    separator = Separator('spleeter:5stems')
    
    # الفصل مع معالجة المسارات كسلاسل نصية
    separator.separate_to_file(input_file, output_dir)
    
    # العثور على المجلد الناتج
    input_filename = os.path.splitext(os.path.basename(input_file))[0]
    result_folder = os.path.join(output_dir, input_filename)
    
    if os.path.exists(result_folder):
        print("\nتم الفصل بنجاح! الملفات الناتجة:")
        for file in os.listdir(result_folder):
            if file.endswith('.wav') or file.endswith('.mp3'):
                print(f"• {file}")
    else:
        print("لم يتم العثور على المجلد الناتج")

except Exception as e:
    print(f"حدث خطأ: {e}")