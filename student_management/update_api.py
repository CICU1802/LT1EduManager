import os
import glob
import re

pages_dir = r"d:\lt1_system\student_management\src\pages"
files = glob.glob(os.path.join(pages_dir, "*.tsx"))
files.append(r"d:\lt1_system\student_management\src\App.tsx")

for filepath in files:
    if not os.path.exists(filepath): continue
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    if "axios" in content:
        # replace axios imports
        content = re.sub(r"import axios from 'axios';", "import api from '../utils/api';", content)
        
        # replace http://localhost:5000
        content = content.replace("axios.get('http://localhost:5000", "api.get('")
        content = content.replace("axios.get(`http://localhost:5000", "api.get(`")
        content = content.replace("axios.post('http://localhost:5000", "api.post('")
        content = content.replace("axios.post(`http://localhost:5000", "api.post(`")
        content = content.replace("axios.put('http://localhost:5000", "api.put('")
        content = content.replace("axios.delete('http://localhost:5000", "api.delete('")
        
        # fallback for any missed ones (like axios.patch)
        content = content.replace("'http://localhost:5000/api", "'/api")
        content = content.replace("`http://localhost:5000/api", "`/api")
        
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"Updated {filepath}")
