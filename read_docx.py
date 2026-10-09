import sys
try:
    import docx
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "python-docx", "pandas", "openpyxl"])
    import docx

def read_docx(file_path):
    doc = docx.Document(file_path)
    full_text = []
    for para in doc.paragraphs:
        full_text.append(para.text)
    return '\n'.join(full_text)

if __name__ == '__main__':
    text = read_docx('d:\\lt1_system\\phần mềm quản lý trung tâm dạy thêm .docx')
    with open('docx_content.md', 'w', encoding='utf-8') as f:
        f.write(text)
    print("Done")
