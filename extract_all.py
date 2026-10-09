import pandas as pd
import glob
import os
import json

files = [
    r"d:\lt1_system\C2 ĐIỂM DANH LT1 (26-27).xlsx",
    r"d:\lt1_system\C3 ĐIỂM DANH LT1 (26-27).xlsx",
    r"d:\lt1_system\CẤP 2 HP LT1 26 - 27 .xlsx",
    r"d:\lt1_system\CẤP 3 HP LT1 26 - 27 .xlsx"
]

results = {}

for file in files:
    try:
        # Read all sheets
        xls = pd.ExcelFile(file)
        results[os.path.basename(file)] = {}
        for sheet_name in xls.sheet_names:
            df = pd.read_excel(file, sheet_name=sheet_name, nrows=5)
            # Convert Timestamps
            for col in df.select_dtypes(include=['datetime64', 'datetimetz']).columns:
                df[col] = df[col].astype(str)
                
            results[os.path.basename(file)][sheet_name] = {
                "columns": df.columns.astype(str).tolist(),
                "sample": df.head(5).astype(str).to_dict(orient='records')
            }
    except Exception as e:
        results[os.path.basename(file)] = {"error": str(e)}

with open(r'd:\lt1_system\full_excel_schema.json', 'w', encoding='utf-8') as f:
    json.dump(results, f, ensure_ascii=False, indent=2)
