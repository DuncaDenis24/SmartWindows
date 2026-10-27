import json
import os
from flask import Flask, jsonify, request
from flask_cors import CORS
import threading
import time
import requests

app = Flask(__name__)
CORS(app)

SETTINGS_FILE = 'settings.json'

def load_settings():
    # Structură nouă: rooms conține setările și credențialele per cameră
    default = {
        "admin_user": "admin",
        "admin_pass": "admin123",
        "rooms": {
            "Camera 101": {
                "co2_limit": 1000, "temp_limit": 25.0, "hum_limit": 60,
                "username": "student1", "password": "parola1"
            },
            "Camera 102": {
                "co2_limit": 1100, "temp_limit": 26.0, "hum_limit": 65,
                "username": "student2", "password": "parola2"
            }
        },
        "last_city": "Cluj-Napoca",
        "last_out_temp": 18.0,
        "last_out_hum": 45.0,
        "last_out_co2": 415
    }
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE, 'r') as f:
                return json.load(f)
        except: return default
    return default


def save_settings_to_file(data):
    with open(SETTINGS_FILE, 'w') as f:
        json.dump(data, f, indent=4)

current_settings = load_settings()

# Datele LIVE pentru fiecare cameră (stocate separat de setările permanente)
rooms_live_data = {}
for room_name in current_settings["rooms"]:
    rooms_live_data[room_name] = {
        "co2": 450, "humidity": 50.0, "temp": 22.0, "window_dirt": 0,
        "is_cleaning": False, "windows_open": False
    }

def get_outside_weather():
    global current_settings
    while True:
        try:
            geo_res = requests.get('http://ip-api.com/json/', timeout=5).json()
            if geo_res['status'] == 'success':
                city = geo_res.get('city', "Cluj-Napoca")
                lat, lon = geo_res['lat'], geo_res['lon']
                w_url = f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&hourly=relative_humidity_2m&current_weather=true"
                w_data = requests.get(w_url, timeout=5).json()
                
                current_settings.update({
                    "last_city": city,
                    "last_out_temp": w_data['current_weather']['temperature'],
                    "last_out_hum": w_data['hourly']['relative_humidity_2m'][0]
                })
                save_settings_to_file(current_settings)
                print(f"☀️ Vreme actualizată pentru {city}")
        except Exception as e: print(f"⚠️ Eroare Weather: {e}")
        time.sleep(600) # Update la 10 minute

def simulate_environment():
    global rooms_live_data
    while True:
        out_temp = current_settings.get("last_out_temp", 18.0)
        out_co2 = current_settings.get("last_out_co2", 415)
        
        for room_name, data in rooms_live_data.items():
            if not data["windows_open"]:
                data["co2"] += 2
                data["temp"] = min(30.0, data["temp"] + 0.05)
                data["humidity"] = min(85.0, data["humidity"] + 0.1)
            else:
                # Efectul de aerisire tinde spre valorile de afară
                data["co2"] += (out_co2 - data["co2"]) * 0.1
                data["temp"] += (out_temp - data["temp"]) * 0.1
                data["humidity"] += (current_settings.get("last_out_hum", 45) - data["humidity"]) * 0.1
            
            if not data["is_cleaning"]:
                data["window_dirt"] = min(100, data["window_dirt"] + 0.5)
        time.sleep(3)

@app.route('/login', methods=['POST'])
def login():
    data = request.json
    u, p = data.get("username"), data.get("password")
    
    # Verificare Admin
    if u == current_settings["admin_user"] and p == current_settings["admin_pass"]:
        return jsonify({
            "status": "success", "isAdmin": True, "user": u, 
            "room": list(current_settings["rooms"].keys())[0], # Prima cameră default
            "allRooms": list(current_settings["rooms"].keys())
        }), 200
    
    # Verificare Studenți (per cameră)
    for room_name, room_cfg in current_settings["rooms"].items():
        if u == room_cfg["username"] and p == room_cfg["password"]:
            return jsonify({
                "status": "success", "isAdmin": False, "user": u, 
                "room": room_name,
                "allRooms": list(current_settings["rooms"].keys())
            }), 200
            
    return jsonify({"status": "error"}), 401

@app.route('/status', methods=['GET'])
def get_status():
    room_name = request.args.get('room')
    if not room_name or room_name not in rooms_live_data:
        return jsonify({"error": "Camera invalidă"}), 404
        
    combined = {
        **rooms_live_data[room_name],
        **current_settings["rooms"][room_name],
        "city": current_settings["last_city"],
        "outside": {
            "temp": current_settings["last_out_temp"],
            "humidity": current_settings["last_out_hum"],
            "co2": current_settings["last_out_co2"]
        }
    }
    return jsonify(combined)

@app.route('/all_status', methods=['GET'])
def get_all_status():
    all_rooms_data = {}
    for room_name in rooms_live_data:
        all_rooms_data[room_name] = {
            **rooms_live_data[room_name],
            **current_settings["rooms"][room_name],
            "city": current_settings["last_city"],
            "outside": {
                "temp": current_settings["last_out_temp"],
                "humidity": current_settings["last_out_hum"],
                "co2": current_settings["last_out_co2"]
            }
        }
    return jsonify(all_rooms_data)

@app.route('/update_settings', methods=['POST'])
def update_settings():
    data = request.json
    room_name = data.get("room")
    if room_name in current_settings["rooms"]:
        current_settings["rooms"][room_name].update({
            "co2_limit": int(data.get("co2_limit")),
            "temp_limit": float(data.get("temp_limit")),
            "hum_limit": int(data.get("hum_limit"))
        })
        save_settings_to_file(current_settings)
        return jsonify({"status": "success"})
    return jsonify({"status": "error"}), 400

@app.route('/action', methods=['POST'])
def perform_action():
    data = request.json
    room_name, action = data.get("room"), data.get("action")
    if room_name in rooms_live_data:
        room = rooms_live_data[room_name]
        if action == "start_clean": room["is_cleaning"] = True
        elif action == "finish_clean": room["is_cleaning"] = False; room["window_dirt"] = 0
        elif action == "toggle_windows": room["windows_open"] = not room["windows_open"]
        return jsonify({"status": "success"})
    return jsonify({"status": "error"}), 400

if __name__ == '__main__':
    threading.Thread(target=get_outside_weather, daemon=True).start()
    threading.Thread(target=simulate_environment, daemon=True).start()
    app.run(host='0.0.0.0', port=5000)