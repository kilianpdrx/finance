import time
import xml.etree.ElementTree as ET
import io
import requests
import pandas as pd

# ==========================================
# CONFIGURATION (Replace with your Step 0 info)
# ==========================================
FLEX_TOKEN = "298887948983567458373"
QUERY_ID = "1554219"
# Official Base URL from the IBKR Developer Manual
INITIATE_URL = f"https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/SendRequest?t={FLEX_TOKEN}&q={QUERY_ID}&v=3"


def fetch_ibkr_data():
    print("Step 1: Sending request to IBKR...")
    
    try:
        # Request with a 15-second timeout to handle slow DNS resolution
        response = requests.get(INITIATE_URL, timeout=15)
    except requests.exceptions.ConnectionError:
        print("❌ Network Error: Could not resolve or reach IBKR. Check internet/VPN.")
        return None
    except requests.exceptions.Timeout:
        print("❌ Timeout Error: IBKR took too long to respond.")
        return None
        
    if response.status_code != 200:
        print(f"❌ Connection error: {response.status_code}")
        return None
        
    # Parse the XML handshake response
    try:
        root = ET.fromstring(response.content)
        status = root.find("Status").text
        
        if status != "Success":
            error_msg = root.find("ErrorMessage").text
            print(f"❌ IBKR Error: {error_msg}")
            return None
            
        reference_code = root.find("ReferenceCode").text
        
        # DYNAMIC FIX: Extract the exact download URL provided by IBKR's server response
        download_url_base = root.find("Url").text or root.find("url").text
        
        print(f"✅ Handshake successful.")
        print(f"-> Reference Code: {reference_code}")
        print(f"-> Designated Download Server: {download_url_base}")
        
    except Exception as e:
        print(f"❌ Failed to parse initial XML response: {e}")
        print(f"Raw Response received: {response.text}")
        return None

    # 2. Give IBKR a few seconds to compile your data
    print("Waiting 5 seconds for IBKR to build the report...")
    time.sleep(5)

    print("Step 2: Downloading the data...")
    
    # 💡 ADD THIS LINE TO FIX THE DNS ERROR:
    # This replaces 'gdcdyn' with 'ndcdyn' if IBKR sends back the broken server domain
    download_url_base = download_url_base.replace("gdcdyn.", "ndcdyn.")

    # 3. Retrieve final data using the code and the modified server URL
    download_url = f"{download_url_base}?q={reference_code}&t={FLEX_TOKEN}&v=3"
    
    try:
        data_response = requests.get(download_url, timeout=20)
    except Exception as e:
        print(f"❌ Failed during data download phase: {e}")
        return None
        
    if data_response.status_code == 200:
        print("✅ Data successfully downloaded!")
        return data_response.content
    else:
        print(f"❌ Failed to download data. Status code: {data_response.status_code}")
        return None


def parse_and_display(raw_data):
    try:
        # Convert the raw bytes data into an XML element tree object
        root = ET.fromstring(raw_data)
        
        # Locate the <OpenPositions> section inside the XML data structure
        open_positions = root.findall(".//OpenPosition")
        
        if not open_positions:
            print("\n⚠️ No open positions found in this statement period or check your Step 0 fields.")
            return

        # Loop through each position block and extract key financial data
        extracted_data = []
        for pos in open_positions:
            extracted_data.append({
                "Symbol": pos.get("symbol"),
                "Asset Class": pos.get("assetCategory"),
                "Quantity": float(pos.get("position", 0)),
                "Avg Price": float(pos.get("markPrice", 0)), # IBKR markPrice is current value
                "Total Value": float(pos.get("positionValue", 0)),
                "Currency": pos.get("currency")
            })
            
        # Convert our clean array of dictionaries into a neat DataFrame table
        df = pd.DataFrame(extracted_data)
        
        print("\n--- YOUR CURRENT HOLDINGS ---")
        print(df.to_string(index=False)) # Cleaner output without index numbers
        
        # Optional: Save it cleanly as a real CSV tracker file
        # df.to_csv("my_portfolio_snapshot.csv", index=False)
        
    except Exception as e:
        print(f"❌ Error parsing the downloaded XML payload: {e}")


if __name__ == "__main__":
    raw_csv_data = fetch_ibkr_data()
    if raw_csv_data:
        parse_and_display(raw_csv_data)