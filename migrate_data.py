import pandas as pd
import numpy as np
import os
import re

# File paths
file_c2_hp = r"d:\lt1_system\CẤP 2 HP LT1 26 - 27 .xlsx"
file_c3_hp = r"d:\lt1_system\CẤP 3 HP LT1 26 - 27 .xlsx"
file_c2_dd = r"d:\lt1_system\C2 ĐIỂM DANH LT1 (26-27).xlsx"
file_c3_dd = r"d:\lt1_system\C3 ĐIỂM DANH LT1 (26-27).xlsx"

# Data structures
students = {} # key: (name_cap), value: details
classes = {} # key: (name), value: details
enrollments = [] 
attendance = [] 
tuitions = [] 

cap2_counter = 1
cap3_counter = 1

def clean_name(name):
    if pd.isna(name): return ""
    return str(name).strip().title()

def get_or_create_student(name, cap, phone="", note=""):
    global cap2_counter, cap3_counter
    name = clean_name(name)
    if not name: return None
    
    key = f"{name}_{cap}"
    
    if key not in students:
        ma_hs = ""
        if cap == 2:
            ma_hs = f"HS262{cap2_counter:04d}"
            cap2_counter += 1
        else:
            ma_hs = f"HS263{cap3_counter:04d}"
            cap3_counter += 1
            
        students[key] = {
            "MaHS": ma_hs,
            "HoTen": name,
            "SDT_HS": "",
            "SDT_PH": str(phone) if pd.notna(phone) and phone != "" else "",
            "TenPH": "",
            "NgaySinh": "",
            "Truong": "",
            "LopKhoi": "",
            "NgayVao": "2026",
            "TrangThai": "Đang học",
            "TrangThaiCongNo": "Hoàn tất",
            "SoBuoiVang": 0,
            "GhiChu": str(note) if pd.notna(note) and note != "" else ""
        }
    else:
        # Update phone or note if missing
        if pd.notna(phone) and phone != "" and students[key]["SDT_PH"] == "":
            students[key]["SDT_PH"] = str(phone)
        if pd.notna(note) and note != "":
            if students[key]["GhiChu"]:
                students[key]["GhiChu"] += f"; {note}"
            else:
                students[key]["GhiChu"] = str(note)
                
    return students[key]["MaHS"]

# 1 & 2. Process Tuition files
def process_tuition(file_path, cap):
    try:
        xls = pd.ExcelFile(file_path)
        for sheet_name in xls.sheet_names:
            if any(x in sheet_name.lower() for x in ["nhắc", "đóng", "giảm", "thiếu", "bản sao"]):
                continue
                
            df = pd.read_excel(xls, sheet_name=sheet_name)
            
            header_row_idx = -1
            name_col_idx = -1
            for idx, row in df.iterrows():
                for col_idx, val in enumerate(row):
                    str_val = str(val).lower()
                    if "họ và tên" in str_val or "tên hs" in str_val or "tên học sinh" in str_val:
                        header_row_idx = idx
                        name_col_idx = col_idx
                        break
                if header_row_idx != -1:
                    break
            
            if header_row_idx != -1 and name_col_idx != -1:
                headers = df.iloc[header_row_idx].values
                # Find column indices for other fields
                phone_idx = -1
                school_idx = -1
                tuition_idx = -1
                date_idx = -1
                note_idx = -1
                
                for i, h in enumerate(headers):
                    sh = str(h).lower()
                    if "sđt" in sh or "điện thoại" in sh: phone_idx = i
                    elif "trường" in sh: school_idx = i
                    elif "thực đóng" in sh or "số tiền" in sh or "số tiền thu" in sh or "học phí" in sh: tuition_idx = i
                    elif "ngày đóng" in sh or "ngày thu" in sh: date_idx = i
                    elif "ghi chú" in sh: note_idx = i

                for idx in range(header_row_idx + 1, len(df)):
                    row = df.iloc[idx]
                    student_name = row.iloc[name_col_idx]
                    if pd.isna(student_name) or str(student_name).strip() == "":
                        continue
                        
                    phone = row.iloc[phone_idx] if phone_idx != -1 else ""
                    school = row.iloc[school_idx] if school_idx != -1 else ""
                    note = row.iloc[note_idx] if note_idx != -1 else ""
                    
                    ma_hs = get_or_create_student(student_name, cap, phone, note)
                    
                    if ma_hs:
                        key = f"{clean_name(student_name)}_{cap}"
                        if pd.notna(school) and str(school).strip() and not students[key]["Truong"]:
                            students[key]["Truong"] = str(school).strip()
                            
                        # Tuition records
                        so_tien = row.iloc[tuition_idx] if tuition_idx != -1 else ""
                        ngay_thu = row.iloc[date_idx] if date_idx != -1 else ""
                        if pd.notna(so_tien) and str(so_tien).strip() and str(so_tien).strip() != "nan":
                            tuitions.append({
                                "ID_HoaDon": f"HD{len(tuitions)+1:04d}",
                                "MaHS": ma_hs,
                                "HoTen": clean_name(student_name),
                                "SoTien": so_tien,
                                "NgayThu": ngay_thu,
                                "PhuongThuc": "Tiền mặt / Chuyển khoản",
                                "TrangThai": "Đã nộp"
                            })
                            
    except Exception as e:
        print(f"Error reading tuition: {e}")

process_tuition(file_c2_hp, 2)
process_tuition(file_c3_hp, 3)

# 3. Process Attendance files
def process_attendance(file_path, cap):
    try:
        xls = pd.ExcelFile(file_path)
        for sheet_name in xls.sheet_names:
            if "ĐGNL" in sheet_name or "đội tuyển" in sheet_name.lower():
                continue
                
            df = pd.read_excel(file_path, sheet_name=sheet_name)
            
            lich_hoc = ""
            giao_vien = ""
            for i in range(min(5, len(df))):
                for col in df.columns:
                    val = str(df.iloc[i][col])
                    if "LỊCH HỌC" in val.upper(): lich_hoc = val
                    if "GV" in val.upper(): giao_vien = val
            
            ma_lop = sheet_name.strip()
            classes[ma_lop] = {
                "MaLop": ma_lop,
                "TenLop": ma_lop,
                "Khoi": re.search(r'\d+', ma_lop).group() if re.search(r'\d+', ma_lop) else "",
                "GiaoVien": giao_vien.replace("GV :", "").replace("GV:", "").strip(),
                "HocPhi": 0,
                "LichHoc": lich_hoc.replace("LỊCH HỌC :", "").strip()
            }
            
            header_row_idx = -1
            name_col_idx = -1
            for idx, row in df.iterrows():
                for col_idx, val in enumerate(row):
                    str_val = str(val).lower()
                    if "họ và tên" in str_val or "tên" in str_val or "họ tên" in str_val:
                        header_row_idx = idx
                        name_col_idx = col_idx
                        break
                if header_row_idx != -1:
                    break
            
            if header_row_idx != -1 and name_col_idx != -1:
                headers = df.iloc[header_row_idx].values
                for idx in range(header_row_idx + 1, len(df)):
                    row = df.iloc[idx]
                    student_name = row.iloc[name_col_idx]
                    if pd.isna(student_name) or str(student_name).strip() == "":
                        continue
                        
                    ma_hs = get_or_create_student(student_name, cap)
                    if ma_hs:
                        enrollments.append({
                            "MaHS": ma_hs,
                            "MaLop": ma_lop,
                            "NgayDangKy": ""
                        })
                        
                        for col_idx in range(name_col_idx + 1, len(row)):
                            date_val = str(headers[col_idx]).strip()
                            if date_val and date_val != "nan" and "Unnamed" not in date_val:
                                status = row.iloc[col_idx]
                                if pd.notna(status) and str(status).strip() != "":
                                    attendance.append({
                                        "ID_DiemDanh": f"DD{len(attendance)+1:05d}",
                                        "MaLop": ma_lop,
                                        "NgayHoc": date_val,
                                        "MaHS": ma_hs,
                                        "HoTen": clean_name(student_name),
                                        "TrangThai": "Có mặt",
                                        "GhiChu": ""
                                    })
    except Exception as e:
        print(f"Error reading attendance: {e}")

process_attendance(file_c2_dd, 2)
process_attendance(file_c3_dd, 3)

unique_enrollments = []
seen = set()
for e in enrollments:
    key = (e["MaHS"], e["MaLop"])
    if key not in seen:
        seen.add(key)
        unique_enrollments.append(e)

# Aggregate new columns before creating dataframe
enrollment_map = {}
for e in unique_enrollments:
    ma_hs = e["MaHS"]
    if ma_hs not in enrollment_map:
        enrollment_map[ma_hs] = []
    enrollment_map[ma_hs].append(e["MaLop"])

debt_map = {}
for t in tuitions:
    if str(t["TrangThai"]).strip() != "Đã nộp":
        debt_map[t["MaHS"]] = "Đang nợ"

absent_map = {}
for a in attendance:
    if a["TrangThai"] in ["Vắng", "Vắng mặt"]:
        ma_hs = a["MaHS"]
        absent_map[ma_hs] = absent_map.get(ma_hs, 0) + 1

for key, student in students.items():
    ma_hs = student["MaHS"]
    student["LopKhoi"] = ", ".join(enrollment_map.get(ma_hs, []))
    student["TrangThaiCongNo"] = debt_map.get(ma_hs, "Hoàn tất")
    student["SoBuoiVang"] = absent_map.get(ma_hs, 0)

# Create DataFrames
df_hocsinh = pd.DataFrame(list(students.values()))
df_lophoc = pd.DataFrame(list(classes.values()))
df_dangky = pd.DataFrame(unique_enrollments)
df_diemdanh = pd.DataFrame(attendance)
df_hocphi = pd.DataFrame(tuitions)

# Save to separate Excel files as requested for the new architecture
out_dir = r"d:\lt1_system"
df_hocsinh.to_excel(os.path.join(out_dir, 'DB_HocSinh.xlsx'), index=False)
df_lophoc.to_excel(os.path.join(out_dir, 'DB_LopHoc.xlsx'), index=False)
df_dangky.to_excel(os.path.join(out_dir, 'DB_DangKyLop.xlsx'), index=False)
df_diemdanh.to_excel(os.path.join(out_dir, 'DB_DiemDanh.xlsx'), index=False)
df_hocphi.to_excel(os.path.join(out_dir, 'DB_HocPhi.xlsx'), index=False)

print("Migration completed! Created separate DB files.")
print(f"Total Students: {len(df_hocsinh)}")
print(f"Total Classes: {len(df_lophoc)}")
print(f"Total Attendance Records: {len(df_diemdanh)}")
print(f"Total Tuitions: {len(df_hocphi)}")
