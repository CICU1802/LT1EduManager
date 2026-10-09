import pandas as pd
import glob
import os
import json

folder_path = r"d:\lt1_system"
excel_files = glob.glob(os.path.join(folder_path, "*.xlsx"))

results = {}

for file in excel_files:
    try:
        df = pd.read_excel(file, nrows=3)
        # Convert Timestamps to strings to allow JSON serialization
        for col in df.select_dtypes(include=['datetime64', 'datetimetz']).columns:
            df[col] = df[col].astype(str)
            
        results[os.path.basename(file)] = {
            "columns": df.columns.tolist(),
            "data_sample": df.head(1).to_dict(orient='records')
        }
    except Exception as e:
        results[os.path.basename(file)] = {"error": str(e)}

with open('excel_schema.json', 'w', encoding='utf-8') as f:
    json.dump(results, f, ensure_ascii=False, indent=2, default=str)
