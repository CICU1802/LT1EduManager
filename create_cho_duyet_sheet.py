import os
import json
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build
from dotenv import load_dotenv

load_dotenv('server/.env')

SCOPES = ['https://www.googleapis.com/auth/spreadsheets']
credentials_path = 'server/google-credentials.json'

if os.path.exists(credentials_path):
    creds = Credentials.from_service_account_file(credentials_path, scopes=SCOPES)
else:
    creds_json = json.loads(os.environ.get('GOOGLE_CREDENTIALS_JSON', '{}'))
    creds = Credentials.from_service_account_info(creds_json, scopes=SCOPES)

service = build('sheets', 'v4', credentials=creds)
spreadsheet_id = os.environ.get('SPREADSHEET_ID')

sheet_name = 'DB_ChoDuyet'

# Check if sheet exists
sheet_metadata = service.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
sheets = sheet_metadata.get('sheets', '')
exists = any(sheet.get("properties", {}).get("title") == sheet_name for sheet in sheets)

if not exists:
    requests = [{
        'addSheet': {
            'properties': {
                'title': sheet_name
            }
        }
    }]
    body = { 'requests': requests }
    service.spreadsheets().batchUpdate(spreadsheetId=spreadsheet_id, body=body).execute()
    
    # Write headers
    headers = [["ID", "Ngày", "Lớp", "Tên học sinh", "SĐT/Ghi chú", "Người báo cáo", "Trạng thái"]]
    body = { 'values': headers }
    service.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id,
        range=f'{sheet_name}!A1:G1',
        valueInputOption='RAW',
        body=body
    ).execute()
    print("Created DB_ChoDuyet")
else:
    print("DB_ChoDuyet already exists")
