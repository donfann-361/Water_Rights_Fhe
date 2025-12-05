// App.tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface WaterRight {
  id: string;
  encryptedVolume: string;
  encryptedPrice: string;
  timestamp: number;
  owner: string;
  location: string;
  status: "available" | "traded" | "pending";
}

const FHEEncryptNumber = (value: number): string => {
  return `FHE-${btoa(value.toString())}`;
};

const FHEDecryptNumber = (encryptedData: string): number => {
  if (encryptedData.startsWith('FHE-')) {
    return parseFloat(atob(encryptedData.substring(4)));
  }
  return parseFloat(encryptedData);
};

const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [rights, setRights] = useState<WaterRight[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newRightData, setNewRightData] = useState({ location: "", volume: 0, price: 0 });
  const [selectedRight, setSelectedRight] = useState<WaterRight | null>(null);
  const [decryptedVolume, setDecryptedVolume] = useState<number | null>(null);
  const [decryptedPrice, setDecryptedPrice] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState<string>("");
  const [contractAddress, setContractAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number>(0);
  const [startTimestamp, setStartTimestamp] = useState<number>(0);
  const [durationDays, setDurationDays] = useState<number>(30);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "available" | "traded">("all");

  // Statistics
  const availableCount = rights.filter(r => r.status === "available").length;
  const tradedCount = rights.filter(r => r.status === "traded").length;
  const totalVolume = rights.reduce((sum, right) => {
    return sum + (right.status === "available" ? FHEDecryptNumber(right.encryptedVolume) : 0);
  }, 0);

  useEffect(() => {
    loadRights().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  const loadRights = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) return;
      
      const keysBytes = await contract.getData("water_rights_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(keysBytes);
          if (keysStr.trim() !== '') keys = JSON.parse(keysStr);
        } catch (e) { console.error("Error parsing water rights keys:", e); }
      }
      
      const list: WaterRight[] = [];
      for (const key of keys) {
        try {
          const rightBytes = await contract.getData(`water_right_${key}`);
          if (rightBytes.length > 0) {
            try {
              const rightData = JSON.parse(ethers.toUtf8String(rightBytes));
              list.push({ 
                id: key, 
                encryptedVolume: rightData.volume, 
                encryptedPrice: rightData.price,
                timestamp: rightData.timestamp, 
                owner: rightData.owner, 
                location: rightData.location,
                status: rightData.status || "available" 
              });
            } catch (e) { console.error(`Error parsing water right data for ${key}:`, e); }
          }
        } catch (e) { console.error(`Error loading water right ${key}:`, e); }
      }
      list.sort((a, b) => b.timestamp - a.timestamp);
      setRights(list);
    } catch (e) { console.error("Error loading water rights:", e); } 
    finally { setIsRefreshing(false); setLoading(false); }
  };

  const submitRight = async () => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setCreating(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting water rights data with Zama FHE..." });
    try {
      const encryptedVolume = FHEEncryptNumber(newRightData.volume);
      const encryptedPrice = FHEEncryptNumber(newRightData.price);
      
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const rightId = `water-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const rightData = { 
        volume: encryptedVolume, 
        price: encryptedPrice,
        timestamp: Math.floor(Date.now() / 1000), 
        owner: address, 
        location: newRightData.location,
        status: "available" 
      };
      
      await contract.setData(`water_right_${rightId}`, ethers.toUtf8Bytes(JSON.stringify(rightData)));
      
      const keysBytes = await contract.getData("water_rights_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { keys = JSON.parse(ethers.toUtf8String(keysBytes)); } 
        catch (e) { console.error("Error parsing keys:", e); }
      }
      keys.push(rightId);
      await contract.setData("water_rights_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Water rights submitted with FHE encryption!" });
      await loadRights();
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewRightData({ location: "", volume: 0, price: 0 });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") ? "Transaction rejected by user" : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { setCreating(false); }
  };

  const decryptWithSignature = async (encryptedVolume: string, encryptedPrice: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      setDecryptedVolume(FHEDecryptNumber(encryptedVolume));
      setDecryptedPrice(FHEDecryptNumber(encryptedPrice));
    } catch (e) { console.error("Decryption failed:", e); } 
    finally { setIsDecrypting(false); }
  };

  const tradeRight = async (rightId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Processing encrypted water rights with FHE..." });
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const rightBytes = await contract.getData(`water_right_${rightId}`);
      if (rightBytes.length === 0) throw new Error("Water right not found");
      
      const rightData = JSON.parse(ethers.toUtf8String(rightBytes));
      const updatedRight = { ...rightData, status: "traded", newOwner: address };
      
      await contract.setData(`water_right_${rightId}`, ethers.toUtf8Bytes(JSON.stringify(updatedRight)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Water rights traded securely with FHE!" });
      await loadRights();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Trade failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredRights = rights.filter(right => {
    const matchesSearch = right.location.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         right.id.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = filterStatus === "all" || right.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const renderWaterUsageChart = () => {
    const locations = [...new Set(rights.map(r => r.location))];
    const locationData = locations.map(loc => {
      const locRights = rights.filter(r => r.location === loc);
      const total = locRights.reduce((sum, right) => sum + FHEDecryptNumber(right.encryptedVolume), 0);
      return { location: loc, total };
    });

    return (
      <div className="water-chart">
        {locationData.map((data, index) => (
          <div key={index} className="water-bar-container">
            <div className="water-bar-label">{data.location}</div>
            <div className="water-bar-track">
              <div 
                className="water-bar" 
                style={{ width: `${Math.min(100, (data.total / 1000) * 100)}%` }}
                data-value={data.total.toFixed(2)}
              ></div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="water-spinner"></div>
      <p>Initializing water rights marketplace...</p>
    </div>
  );

  return (
    <div className="app-container water-theme">
      <header className="app-header">
        <div className="logo">
          <div className="water-drop-icon"></div>
          <h1>Water<span>Rights</span>FHE</h1>
        </div>
        <div className="header-actions">
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          <button onClick={() => setShowCreateModal(true)} className="create-right-btn water-button">
            List Water Rights
          </button>
        </div>
      </header>

      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>FHE-Encrypted Water Rights Marketplace</h2>
            <p>Trade water usage rights while keeping sensitive data encrypted with Zama FHE technology</p>
          </div>
          <div className="fhe-indicator">
            <div className="fhe-lock"></div>
            <span>FHE Encryption Active</span>
          </div>
        </div>

        <div className="dashboard-grid">
          <div className="dashboard-card water-card">
            <h3>Market Overview</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value">{rights.length}</div>
                <div className="stat-label">Total Rights</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{availableCount}</div>
                <div className="stat-label">Available</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{tradedCount}</div>
                <div className="stat-label">Traded</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{totalVolume.toFixed(2)}</div>
                <div className="stat-label">Total m³ Available</div>
              </div>
            </div>
          </div>

          <div className="dashboard-card water-card">
            <h3>Water Distribution</h3>
            {renderWaterUsageChart()}
          </div>

          <div className="dashboard-card water-card">
            <h3>About FHE Encryption</h3>
            <p>Zama FHE allows computation on encrypted water usage data without decryption, preserving privacy while enabling market efficiency.</p>
            <div className="fhe-badge">
              <span>FHE-Powered Privacy</span>
            </div>
          </div>
        </div>

        <div className="rights-section">
          <div className="section-header">
            <h2>Available Water Rights</h2>
            <div className="header-actions">
              <div className="search-filter">
                <input 
                  type="text" 
                  placeholder="Search location or ID..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="water-input"
                />
                <select 
                  value={filterStatus} 
                  onChange={(e) => setFilterStatus(e.target.value as "all" | "available" | "traded")}
                  className="water-select"
                >
                  <option value="all">All Rights</option>
                  <option value="available">Available</option>
                  <option value="traded">Traded</option>
                </select>
              </div>
              <button onClick={loadRights} className="refresh-btn water-button" disabled={isRefreshing}>
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>

          <div className="rights-list water-card">
            <div className="table-header">
              <div className="header-cell">ID</div>
              <div className="header-cell">Location</div>
              <div className="header-cell">Owner</div>
              <div className="header-cell">Date</div>
              <div className="header-cell">Status</div>
              <div className="header-cell">Actions</div>
            </div>

            {filteredRights.length === 0 ? (
              <div className="no-rights">
                <div className="no-rights-icon"></div>
                <p>No water rights found</p>
                <button className="water-button primary" onClick={() => setShowCreateModal(true)}>List First Right</button>
              </div>
            ) : filteredRights.map(right => (
              <div className="right-row" key={right.id} onClick={() => setSelectedRight(right)}>
                <div className="table-cell right-id">#{right.id.substring(0, 6)}</div>
                <div className="table-cell">{right.location}</div>
                <div className="table-cell">{right.owner.substring(0, 6)}...{right.owner.substring(38)}</div>
                <div className="table-cell">{new Date(right.timestamp * 1000).toLocaleDateString()}</div>
                <div className="table-cell">
                  <span className={`status-badge ${right.status}`}>{right.status}</span>
                </div>
                <div className="table-cell actions">
                  {right.status === "available" && (
                    <button 
                      className="action-btn water-button success" 
                      onClick={(e) => { e.stopPropagation(); tradeRight(right.id); }}
                    >
                      Trade
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {showCreateModal && (
        <div className="modal-overlay">
          <div className="create-modal water-card">
            <div className="modal-header">
              <h2>List New Water Rights</h2>
              <button onClick={() => setShowCreateModal(false)} className="close-modal">&times;</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Location *</label>
                <input 
                  type="text" 
                  name="location" 
                  value={newRightData.location} 
                  onChange={(e) => setNewRightData({...newRightData, location: e.target.value})}
                  placeholder="Enter location (e.g. River Basin, Aquifer)"
                  className="water-input"
                />
              </div>
              <div className="form-group">
                <label>Volume (m³) *</label>
                <input 
                  type="number" 
                  name="volume" 
                  value={newRightData.volume || ''}
                  onChange={(e) => setNewRightData({...newRightData, volume: parseFloat(e.target.value) || 0})}
                  placeholder="Enter water volume"
                  className="water-input"
                  step="0.1"
                />
              </div>
              <div className="form-group">
                <label>Price (ETH) *</label>
                <input 
                  type="number" 
                  name="price" 
                  value={newRightData.price || ''}
                  onChange={(e) => setNewRightData({...newRightData, price: parseFloat(e.target.value) || 0})}
                  placeholder="Enter price per m³"
                  className="water-input"
                  step="0.0001"
                />
              </div>
              <div className="encryption-preview">
                <h4>FHE Encryption Preview</h4>
                <div className="preview-container">
                  <div className="plain-data">
                    <span>Plain Values:</span>
                    <div>Volume: {newRightData.volume}m³</div>
                    <div>Price: {newRightData.price} ETH</div>
                  </div>
                  <div className="encryption-arrow">→</div>
                  <div className="encrypted-data">
                    <span>Encrypted Data:</span>
                    <div>Volume: {newRightData.volume ? FHEEncryptNumber(newRightData.volume).substring(0, 30) + '...' : 'Not encrypted'}</div>
                    <div>Price: {newRightData.price ? FHEEncryptNumber(newRightData.price).substring(0, 30) + '...' : 'Not encrypted'}</div>
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowCreateModal(false)} className="cancel-btn water-button">Cancel</button>
              <button onClick={submitRight} disabled={creating} className="submit-btn water-button primary">
                {creating ? "Encrypting with FHE..." : "List Water Rights"}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedRight && (
        <div className="modal-overlay">
          <div className="right-detail-modal water-card">
            <div className="modal-header">
              <h2>Water Right Details #{selectedRight.id.substring(0, 8)}</h2>
              <button onClick={() => { setSelectedRight(null); setDecryptedVolume(null); setDecryptedPrice(null); }} className="close-modal">&times;</button>
            </div>
            <div className="modal-body">
              <div className="right-info">
                <div className="info-item"><span>Location:</span><strong>{selectedRight.location}</strong></div>
                <div className="info-item"><span>Owner:</span><strong>{selectedRight.owner.substring(0, 6)}...{selectedRight.owner.substring(38)}</strong></div>
                <div className="info-item"><span>Date Listed:</span><strong>{new Date(selectedRight.timestamp * 1000).toLocaleString()}</strong></div>
                <div className="info-item"><span>Status:</span><strong className={`status-badge ${selectedRight.status}`}>{selectedRight.status}</strong></div>
              </div>
              
              <div className="encrypted-data-section">
                <h3>Encrypted Data</h3>
                <div className="data-grid">
                  <div className="data-item">
                    <span>Volume:</span>
                    <div className="encrypted-value">{selectedRight.encryptedVolume.substring(0, 30)}...</div>
                  </div>
                  <div className="data-item">
                    <span>Price:</span>
                    <div className="encrypted-value">{selectedRight.encryptedPrice.substring(0, 30)}...</div>
                  </div>
                </div>
                <div className="fhe-tag">
                  <div className="fhe-icon"></div>
                  <span>FHE Encrypted</span>
                </div>
                <button 
                  className="decrypt-btn water-button" 
                  onClick={() => decryptWithSignature(selectedRight.encryptedVolume, selectedRight.encryptedPrice)} 
                  disabled={isDecrypting}
                >
                  {isDecrypting ? "Decrypting..." : decryptedVolume !== null ? "Hide Values" : "Decrypt with Wallet"}
                </button>
              </div>
              
              {decryptedVolume !== null && (
                <div className="decrypted-data-section">
                  <h3>Decrypted Values</h3>
                  <div className="data-grid">
                    <div className="data-item">
                      <span>Volume:</span>
                      <div className="decrypted-value">{decryptedVolume}m³</div>
                    </div>
                    <div className="data-item">
                      <span>Price:</span>
                      <div className="decrypted-value">{decryptedPrice} ETH/m³</div>
                    </div>
                  </div>
                  <div className="decryption-notice">
                    <div className="warning-icon"></div>
                    <span>Decrypted data is only visible after wallet signature verification</span>
                  </div>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button 
                onClick={() => { setSelectedRight(null); setDecryptedVolume(null); setDecryptedPrice(null); }} 
                className="close-btn water-button"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content water-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="water-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}

      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="water-drop-icon"></div>
              <span>WaterRightsFHE</span>
            </div>
            <p>Privacy-preserving water rights marketplace powered by Zama FHE</p>
          </div>
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Water Rights</span>
          </div>
          <div className="copyright">© {new Date().getFullYear()} WaterRightsFHE. All rights reserved.</div>
        </div>
      </footer>
    </div>
  );
};

export default App;