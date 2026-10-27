import React, { useState, useEffect } from 'react';
import { 
  StyleSheet, Text, View, TouchableOpacity, TextInput,
  ActivityIndicator, Alert, SafeAreaView, StatusBar,
  LayoutAnimation, Platform, UIManager 
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isOffline, setIsOffline] = useState(false);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [settingsInput, setSettingsInput] = useState({ co2: '1000', temp: '25', hum: '60' });

  // State-uri noi pentru multi-cameră
  const [selectedRoom, setSelectedRoom] = useState(''); 
  const [allRooms, setAllRooms] = useState([]); 
  const [allRoomsData, setAllRoomsData] = useState({}); 

  const [status, setStatus] = useState({ 
  co2: 0, 
  humidity: 0, 
  temp: 0, 
  window_dirt: 90, 
  windows_open: false, 
  co2_limit: 1000, 
  temp_limit: 25, 
  hum_limit: 60,
  city: 'Detectare...', 
  outside: { temp: 0, humidity: 0, co2: 0 } 
});
  const [isCleaning, setIsCleaning] = useState(false);
  const [hasAirAlerted, setHasAirAlerted] = useState(0);

  const SERVER_URL = 'http://10.253.224.142:5000'; 

  const handleLogin = async () => {
    try {
      const response = await fetch(`${SERVER_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await response.json();
      
      if (response.status === 200) {
        setIsAdmin(data.isAdmin);
        setSelectedRoom(data.room);
        if (data.isAdmin) {
            setAllRooms(data.allRooms);
        }
        
        // Încărcăm datele pentru toate camerele simultan
        const allStatusRes = await fetch(`${SERVER_URL}/all_status`);
        const allStatusData = await allStatusRes.json();
        setAllRoomsData(allStatusData);
        
        // Setăm statusul pentru camera curentă
        setStatus(allStatusData[data.room]);
        setSettingsInput({
          co2: allStatusData[data.room].co2_limit.toString(),
          temp: allStatusData[data.room].temp_limit.toString(),
          hum: allStatusData[data.room].hum_limit.toString()
        });

        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setIsLoggedIn(true);
      } else { 
        Alert.alert("Eroare", "Date invalide"); 
      }
    } catch (e) { 
      Alert.alert("Eroare", "Serverul nu răspunde!"); 
    }
  };

  const fetchData = async () => {
    if (!isLoggedIn || !selectedRoom) return;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1500);

    try {
      // Încărcăm datele pentru toate camerele simultan
      const response = await fetch(`${SERVER_URL}/all_status`, { signal: controller.signal });
      const allData = await response.json();
      clearTimeout(timeoutId);
      
      setAllRoomsData(allData);
      const data = allData[selectedRoom];

      setStatus(data);
      setIsOffline(false);
      
      // LOGICA DE ALERTĂ (Păstrată)
      const isCo2High = data.co2 > data.co2_limit;
      const isTempHigh = data.temp > data.temp_limit;
      const isHumHigh = data.humidity > data.hum_limit;
      const isDirtHigh = data.window_dirt > 90;

      const now = Date.now();
      const ALERT_INTERVAL = 30000; 

      const airIssue = isCo2High || isTempHigh || isHumHigh;
      const shouldAlertAir = airIssue && !data.windows_open;
      const shouldAlertDirt = isDirtHigh;

      if (shouldAlertAir || shouldAlertDirt) {
        if (hasAirAlerted === 0 || (now - hasAirAlerted > ALERT_INTERVAL)) {
          setHasAirAlerted(now);
          let mesaj = `[${selectedRoom}] Parametri depășiți: `;
          if (isCo2High) mesaj += "CO2 ";
          if (isTempHigh) mesaj += "Temperatura ";
          if (isHumHigh) mesaj += "Umiditate ";
          if (isDirtHigh) mesaj += "Geamuri Murdare ";

          Alert.alert("⚠️ Atenție Sistem", mesaj, [{ text: "Am înțeles" }]);
        }
      }

      const isEverythingSafe = 
        data.co2 < (data.co2_limit - 40) && 
        data.temp < (data.temp_limit - 0.5) && 
        data.humidity < (data.hum_limit - 5) &&
        data.window_dirt < 80;

      if (isEverythingSafe) {
        setHasAirAlerted(0);
      }

    } catch (e) {
      setIsOffline(true);
    }
  };

  const saveSettings = async () => {
    try {
      const response = await fetch(`${SERVER_URL}/update_settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          room: selectedRoom,
          co2_limit: settingsInput.co2,
          temp_limit: settingsInput.temp,
          hum_limit: settingsInput.hum
        })
      });
      if (response.ok) {
        setShowSettings(false);
        Alert.alert("Succes", `Setările pentru ${selectedRoom} au fost salvate.`);
        fetchData();
      }
    } catch (e) { Alert.alert("Eroare", "Nu s-a putut salva."); }
  };

interface ActionPayload {
  action: string;
  room: string;
}

const runAction = (actionName: string): void => {
  if (!selectedRoom) return; // Siguranță: nu trimitem dacă nu avem cameră selectată

  fetch(`${SERVER_URL}/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      action: actionName, 
      room: selectedRoom 
    } as ActionPayload)
  }).catch((err: Error) => console.log("Eroare acțiune:", err));
};

  useEffect(() => {
    const interval = setInterval(fetchData, 50);
    return () => clearInterval(interval);
  }, [isLoggedIn, selectedRoom, hasAirAlerted]);

  // Sync settings inputs when switching rooms
  useEffect(() => {
    if (status) {
      setSettingsInput({
        co2: status.co2_limit.toString(),
        temp: status.temp_limit.toString(),
        hum: status.hum_limit.toString()
      });
    }
  }, [selectedRoom]);

  if (!isLoggedIn) {
    return (
      <SafeAreaView style={styles.loginContainer}>
        <MaterialCommunityIcons name="shield-key" size={80} color="#007AFF" />
        <Text style={styles.header}>Smart Windows</Text>
        <Text style={styles.subHeader}>Sistem Multi-Cameră</Text>
        <View style={styles.loginCard}>
          <TextInput style={styles.input} placeholder="Utilizator" value={username} onChangeText={setUsername} autoCapitalize="none" />
          <TextInput style={styles.input} placeholder="Parolă" value={password} secureTextEntry onChangeText={setPassword} />
          <TouchableOpacity style={styles.mainButton} onPress={handleLogin}><Text style={styles.buttonText}>AUTENTIFICARE</Text></TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      
      {/* Banner Offline Stilizat */}
      {isOffline && (
        <View style={styles.offlineBanner}>
          <MaterialCommunityIcons name="wifi-off" size={18} color="#FFF" />
          <Text style={styles.offlineText}>MOD OFFLINE - CONEXIUNE PIERDUTĂ</Text>
        </View>
      )}

      <View style={styles.headerContainer}>
        <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'}}>
          <View>
            <Text style={styles.header}>{showSettings ? "Configurare" : selectedRoom}</Text>
            <Text style={styles.subHeader}>
              Salut, <Text style={{fontWeight: 'bold', color: '#007AFF'}}>{username.toUpperCase()}</Text>
            </Text>
          </View>
          
          <View style={{flexDirection: 'row'}}>
            {isAdmin && (
              <TouchableOpacity onPress={() => setShowSettings(!showSettings)}>
                <MaterialCommunityIcons name={showSettings ? "close-circle" : "cog"} size={28} color="#007AFF" style={{marginRight: 15}} />
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => setIsLoggedIn(false)}>
              <MaterialCommunityIcons name="logout" size={28} color="#FF3B30" />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Selector de Camere pentru Admin */}
      {isAdmin && !showSettings && (
        <View style={styles.roomSelector}>
          {allRooms.map(room => (
            <TouchableOpacity 
              key={room} 
              onPress={() => {
                  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                  setSelectedRoom(room);
              }}
              style={[styles.roomTab, selectedRoom === room && styles.roomTabActive]}
            >
              <Text style={[styles.roomTabText, selectedRoom === room && styles.roomTabTextActive]}>{room}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {showSettings ? (
        <View style={styles.card}>
          <Text style={styles.statLabel}>Limite pentru {selectedRoom}:</Text>
          <Text style={styles.statLabel}>Prag CO2 (ppm):</Text>
          <TextInput style={styles.input} keyboardType="numeric" value={settingsInput.co2} onChangeText={(t) => setSettingsInput({...settingsInput, co2: t})} />
          <Text style={styles.statLabel}>Prag Temp (°C):</Text>
          <TextInput style={styles.input} keyboardType="numeric" value={settingsInput.temp} onChangeText={(t) => setSettingsInput({...settingsInput, temp: t})} />
          <Text style={styles.statLabel}>Prag Umiditate (%):</Text>
          <TextInput style={styles.input} keyboardType="numeric" value={settingsInput.hum} onChangeText={(t) => setSettingsInput({...settingsInput, hum: t})} />
          <TouchableOpacity style={styles.mainButton} onPress={saveSettings}><Text style={styles.buttonText}>SALVEAZĂ MODIFICĂRILE</Text></TouchableOpacity>
        </View>
      ) : (
        status && (
        <View>
          <View style={styles.outsideBar}>
            <MaterialCommunityIcons name="map-marker" size={16} color="#007AFF" style={{marginRight: 8}} />
            <Text style={styles.outsideText}>
              {status.city.toUpperCase()} | {status.outside.temp.toFixed(1)}°C | HUM: {status.outside.humidity}% | CO2: {Math.round(status.outside.co2)}ppm
            </Text>
          </View>

          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <MaterialCommunityIcons name="home-analytics" size={26} color="#5856D6" />
              <Text style={styles.cardTitle}>Senzori {selectedRoom}</Text>
            </View>
            <View style={styles.statGrid}>
              <View style={styles.gridItem}>
                <Text style={styles.gridLabel}>CO2</Text>
                <Text style={[styles.gridValue, {color: status.co2 > status.co2_limit ? '#FF3B30' : '#1C1C1E'}]}>{Math.round(status.co2)} <Text style={styles.unit}>ppm</Text></Text>
              </View>
              <View style={styles.gridItem}>
                <Text style={styles.gridLabel}>UMIDITATE</Text>
                <Text style={[styles.gridValue, {color: status.humidity > status.hum_limit ? '#FF3B30' : '#1C1C1E'}]}>{Math.round(status.humidity)}%</Text>
              </View>
              <View style={styles.gridItem}>
                <Text style={styles.gridLabel}>TEMP</Text>
                <Text style={[styles.gridValue, {color: status.temp > status.temp_limit ? '#FF3B30' : '#1C1C1E'}]}>{status.temp.toFixed(1)}°C</Text>
              </View>
            </View>
            <TouchableOpacity 
              style={[styles.actionButton, status.windows_open && styles.actionActive]} 
              onPress={() => runAction('toggle_windows')}
            >
              <MaterialCommunityIcons name={status.windows_open ? "window-open-variant" : "window-closed-variant"} size={22} color="#fff" />
              <Text style={[styles.buttonText, {marginLeft: 10}]}>{status.windows_open ? "FERESTRE DESCHISE" : "DESCHIDE FERESTRELE"}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <MaterialCommunityIcons name="auto-fix" size={26} color="#FF9500" />
              <Text style={styles.cardTitle}>Mentenanță Geam</Text>
            </View>
            <View style={styles.progressBg}>
              <View style={[styles.progressFill, { width: `${100 - status.window_dirt}%`, backgroundColor: status.window_dirt > 80 ? '#FF3B30' : '#34C759' }]} />
            </View>
            <Text style={styles.statLabel}>Claritate: {100 - Math.round(status.window_dirt)}%</Text>
            {isCleaning ? (
              <View style={styles.cleaningOverlay}><ActivityIndicator color="#007AFF" /><Text style={styles.cleaningText}>Sistem în lucru...</Text></View>
            ) : (
              <TouchableOpacity style={styles.mainButton} onPress={() => { 
                  setIsCleaning(true); 
                  runAction('start_clean');
                  setTimeout(() => { 
                    runAction('finish_clean'); 
                    setIsCleaning(false); 
                  }, 4000); 
              }}>
                <Text style={styles.buttonText}>PORNEȘTE CURĂȚAREA</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
        )
      )}
      <Text style={styles.footer}>
        Sistem: {isOffline ? "Offline" : "Online"} • {selectedRoom} • v2.0
      </Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F2F2F7', paddingHorizontal: 20 },
  loginContainer: { flex: 1, backgroundColor: '#F2F2F7', alignItems: 'center', justifyContent: 'center', padding: 20 },
  loginCard: { backgroundColor: '#FFF', padding: 25, borderRadius: 24, width: '100%', elevation: 4 },
  input: { backgroundColor: '#F2F2F7', padding: 15, borderRadius: 12, marginBottom: 15, fontSize: 16 },
  headerContainer: { marginTop: 40, marginBottom: 15 },
  header: { fontSize: 28, fontWeight: '800', color: '#1C1C1E' },
  subHeader: { fontSize: 14, color: '#8E8E93' },
  roomSelector: { flexDirection: 'row', marginBottom: 20, backgroundColor: '#E5E5EA', borderRadius: 12, padding: 4 },
  roomTab: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8 },
  roomTabActive: { backgroundColor: '#FFF', elevation: 2 },
  roomTabText: { fontSize: 12, color: '#8E8E93', fontWeight: '600' },
  roomTabTextActive: { color: '#007AFF', fontWeight: '800' },
  outsideBar: { flexDirection: 'row', backgroundColor: '#FFF', padding: 12, borderRadius: 14, marginBottom: 20, alignItems: 'center', justifyContent: 'center', elevation: 1 },
  outsideText: { fontSize: 11, fontWeight: '700', color: '#3A3A3C' },
  card: { backgroundColor: '#FFF', borderRadius: 24, padding: 22, marginBottom: 20, elevation: 3 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  cardTitle: { fontSize: 18, fontWeight: '700', marginLeft: 12 },
  statGrid: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 25 },
  gridItem: { width: '31%', alignItems: 'center' },
  gridLabel: { fontSize: 9, color: '#8E8E93', fontWeight: '900', marginBottom: 6, textTransform: 'uppercase' },
  gridValue: { fontSize: 16, fontWeight: '700' },
  mainButton: { backgroundColor: '#007AFF', padding: 16, borderRadius: 16, alignItems: 'center' },
  actionButton: { backgroundColor: '#3A3A3C', padding: 16, borderRadius: 16, alignItems: 'center', flexDirection: 'row', justifyContent: 'center' },
  actionActive: { backgroundColor: '#34C759' },
  buttonText: { color: '#FFF', fontWeight: '800', fontSize: 12 },
  progressBg: { height: 8, backgroundColor: '#F2F2F7', borderRadius: 4, marginBottom: 12 },
  progressFill: { height: 8, borderRadius: 4 },
  statLabel: { color: '#8E8E93', fontSize: 12, fontWeight: '600', marginBottom: 10 },
  cleaningOverlay: { alignItems: 'center', paddingVertical: 10 },
  cleaningText: { marginTop: 10, color: '#007AFF', fontWeight: '700' },
  offlineBanner: { backgroundColor: '#FF3B30', padding: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  offlineText: { color: '#FFF', fontWeight: '700', fontSize: 12 },
  footer: { textAlign: 'center', color: '#8E8E93', fontSize: 11, marginBottom: 10 },
  unit: { fontSize: 12, fontWeight: '500' }});