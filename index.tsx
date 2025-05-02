import { webpack } from "@webpack/common";
import { Devs } from "@utils/constants";
import { definePlugin } from "@utils/types";
import { FluxDispatcher } from "@webpack/common";
import { React } from "@webpack/common";

// Define lazy-loaded Discord stores and modules
const findStore = (name) => webpack.getStore(name);
const findByProps = (...props) => webpack.getByProps(...props);

const UserSettingsStore = findStore("UserSettingsStore");
const ChannelStore = findStore("ChannelStore");
const GuildStore = findStore("GuildStore");
const UserStore = findStore("UserStore");
const MessageStore = findStore("MessageStore");
const StatusStore = findStore("StatusStore");
const NotificationSettingsStore = findStore("NotificationSettingsStore");

const NotificationActions = findByProps("updateChannelOverrideSettings");
const MessageActions = findByProps("addButton", "removeButton");

// Interface for plugin settings
interface BRBSettings {
    isActive: boolean;
    customStatusText: string;
    unmutedChannels: string[];
    timeAway: number;
    digestFormat: "short" | "detailed";
    savePreviousStatus: boolean;
    previousStatus: {
        status: string;
        customStatus: {
            text: string;
            emoji: string;
        } | null;
    } | null;
    showDigestOnReturn: boolean;
}

// Interface for collected messages while away
interface DigestData {
    mentions: any[];
    unmutedChannelMessages: Record<string, any[]>;
    directMessages: any[];
    everyoneMentions: any[];
    startTime: number;
}

// Utility functions for storage
const DEFAULT_SETTINGS = {
    isActive: false,
    customStatusText: "AFK - Be Right Back",
    unmutedChannels: [],
    digestFormat: "detailed" as "short" | "detailed",
    savePreviousStatus: true,
    previousStatus: null,
    showDigestOnReturn: true,
    timeAway: 0
};

function saveSettings(settings: Partial<BRBSettings>): void {
    try {
        // Get existing settings first
        const existingSettings = loadSettings();
        
        // Merge with new settings
        const newSettings = {
            ...existingSettings,
            ...settings
        };
        
        // Save to Vencord's settings
        const vencordSettings = window.Vencord?.Settings?.plugins?.BRBMode || {};
        window.Vencord.Settings.plugins.BRBMode = {
            ...vencordSettings,
            ...newSettings
        };
        window.Vencord.Settings.save();
    } catch (error) {
        console.error("[BRBMode] Error saving settings:", error);
    }
}

function loadSettings(): BRBSettings {
    try {
        // Load from Vencord's settings
        const savedSettings = window.Vencord?.Settings?.plugins?.BRBMode || {};
        
        // Merge with default settings to ensure all properties exist
        return {
            ...DEFAULT_SETTINGS,
            ...savedSettings
        };
    } catch (error) {
        console.error("[BRBMode] Error loading settings:", error);
        return { ...DEFAULT_SETTINGS };
    }
}

// Utility functions for status
function setStatus(status: string): void {
    try {
        const StatusUpdateModule = findByProps("updateStatus");
        if (!StatusUpdateModule) {
            console.error("[BRBMode] Status update module not found");
            return;
        }

        // Validate status value
        const validStatuses = ["online", "idle", "dnd", "invisible"];
        if (!validStatuses.includes(status)) {
            console.error(`[BRBMode] Invalid status: ${status}. Must be one of: ${validStatuses.join(", ")}`);
            return;
        }

        // Update status
        StatusUpdateModule.updateStatus(status);
    } catch (error) {
        console.error("[BRBMode] Error setting status:", error);
    }
}

function setCustomStatus(text: string, emoji?: string): void {
    try {
        const CustomStatusModule = findByProps("updateRemoteSettings");
        if (!CustomStatusModule) {
            console.error("[BRBMode] Custom status module not found");
            return;
        }

        // Prepare custom status object
        const customStatus: any = {
            text: text || "",
        };

        // Add emoji if provided
        if (emoji) {
            if (emoji.length === 1 || emoji.match(/^\d+$/)) {
                // Unicode emoji or snowflake
                customStatus.emoji_name = emoji;
            } else if (emoji.match(/^[a-zA-Z0-9_]+$/)) {
                // Discord emoji name
                customStatus.emoji_name = emoji;
            }
        }

        // Update custom status
        CustomStatusModule.updateRemoteSettings({
            customStatus
        });
    } catch (error) {
        console.error("[BRBMode] Error setting custom status:", error);
    }
}

function resetStatus(
    status: string = "online", 
    customStatus: { text: string, emoji: string } | null = null
): void {
    try {
        // Reset status
        setStatus(status);
        
        // Reset custom status if provided, otherwise clear it
        if (customStatus) {
            setCustomStatus(customStatus.text, customStatus.emoji);
        } else {
            // Clear custom status
            findByProps("updateRemoteSettings").updateRemoteSettings({
                customStatus: null
            });
        }
    } catch (error) {
        console.error("[BRBMode] Error resetting status:", error);
    }
}

export default definePlugin({
    name: "BRBMode",
    description: "Enables a 'Be Right Back' mode with custom status, channel muting, and message digests",
    authors: [Devs.Vencord],
    dependencies: [],

    // Plugin data
    settings: DEFAULT_SETTINGS as BRBSettings,
    digestData: null as DigestData | null,
    originalChannelSettings: {} as Record<string, any>,
    isCollectingMessages: false,

    // Define plugin settings component
    settingsAboutComponent: () => <div>Configure the "Be Right Back" mode settings</div>,
    settingsComponent() {
        return (
            <div>
                <h2>BRB Mode Settings</h2>
                
                <div style={{ marginBottom: "16px" }}>
                    <h3>BRB Status</h3>
                    <p>Current status: {this.settings.isActive ? "Active (Away)" : "Inactive"}</p>
                    <button 
                        onClick={this.toggleBRBMode.bind(this)}
                        style={{ 
                            padding: "8px 16px", 
                            background: this.settings.isActive ? "#f04747" : "#43b581",
                            color: "white",
                            border: "none",
                            borderRadius: "3px",
                            cursor: "pointer"
                        }}
                    >
                        {this.settings.isActive ? "Deactivate BRB Mode" : "Activate BRB Mode"}
                    </button>
                </div>
                
                <div style={{ marginBottom: "16px" }}>
                    <h3>Custom Status Text</h3>
                    <p>Custom status message to display when you're away</p>
                    <input 
                        type="text"
                        value={this.settings.customStatusText}
                        onChange={e => {
                            this.settings.customStatusText = e.target.value;
                            saveSettings(this.settings);
                        }}
                        placeholder="AFK, be right back..."
                        style={{ 
                            width: "100%", 
                            padding: "8px",
                            background: "#2f3136",
                            border: "none",
                            borderRadius: "3px",
                            color: "#dcddde"
                        }}
                    />
                </div>
                
                <div style={{ marginBottom: "16px" }}>
                    <h3>Digest Format</h3>
                    <p>Choose how detailed your message digest will be when you return</p>
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                        <label style={{ display: "flex", alignItems: "center" }}>
                            <input 
                                type="radio"
                                checked={this.settings.digestFormat === "short"}
                                onChange={() => {
                                    this.settings.digestFormat = "short";
                                    saveSettings(this.settings);
                                }}
                                style={{ marginRight: "8px" }}
                            />
                            Short Summary
                        </label>
                        <label style={{ display: "flex", alignItems: "center" }}>
                            <input 
                                type="radio"
                                checked={this.settings.digestFormat === "detailed"}
                                onChange={() => {
                                    this.settings.digestFormat = "detailed";
                                    saveSettings(this.settings);
                                }}
                                style={{ marginRight: "8px" }}
                            />
                            Detailed Digest
                        </label>
                    </div>
                </div>
                
                <div style={{ marginBottom: "8px" }}>
                    <label style={{ display: "flex", alignItems: "center" }}>
                        <input 
                            type="checkbox"
                            checked={this.settings.savePreviousStatus}
                            onChange={() => {
                                this.settings.savePreviousStatus = !this.settings.savePreviousStatus;
                                saveSettings(this.settings);
                            }}
                            style={{ marginRight: "8px" }}
                        />
                        Save Previous Status (Remember and restore your previous status)
                    </label>
                </div>
                
                <div>
                    <label style={{ display: "flex", alignItems: "center" }}>
                        <input 
                            type="checkbox"
                            checked={this.settings.showDigestOnReturn}
                            onChange={() => {
                                this.settings.showDigestOnReturn = !this.settings.showDigestOnReturn;
                                saveSettings(this.settings);
                            }}
                            style={{ marginRight: "8px" }}
                        />
                        Show Digest On Return (Show message digest automatically when you return)
                    </label>
                </div>
            </div>
        );
    },

    // Plugin lifecycle methods
    start() {
        // Load saved settings
        this.settings = loadSettings();
        
        // Check if the plugin was enabled when Discord was closed and reset if needed
        if (this.settings.isActive) {
            this.settings.isActive = false;
            saveSettings(this.settings);
        }
        
        // Register message listener for collecting messages when away
        FluxDispatcher.subscribe("MESSAGE_CREATE", this.onMessageCreate.bind(this));
        
        // Add BRB button to the Discord UI
        this.addBRBButton();
    },

    stop() {
        // If BRB mode is active when plugin is disabled, reset status
        if (this.settings.isActive) {
            this.deactivateBRBMode(false);
        }
        
        // Unregister listeners and remove button
        FluxDispatcher.unsubscribe("MESSAGE_CREATE", this.onMessageCreate.bind(this));
        if (MessageActions && MessageActions.removeButton) {
            MessageActions.removeButton("brb-button");
        }
    },

    // Add BRB button to Discord's status menu
    addBRBButton() {
        if (!MessageActions || !MessageActions.addButton) {
            console.error("[BRBMode] MessageActions not found");
            return;
        }
        
        const BRBButton = () => {
            const [active, setActive] = React.useState(this.settings.isActive);
            
            React.useEffect(() => {
                const checkStatus = () => {
                    setActive(this.settings.isActive);
                };
                
                // Set up interval to check BRB status
                const interval = setInterval(checkStatus, 1000);
                return () => clearInterval(interval);
            }, []);
            
            return (
                <div 
                    style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "8px 12px",
                        borderRadius: "4px",
                        margin: "8px",
                        cursor: "pointer",
                        fontWeight: 500,
                        transition: "background-color 0.2s, color 0.2s",
                        backgroundColor: active ? "#f04747" : "#2f3136",
                        color: active ? "white" : "#dcddde"
                    }}
                    onClick={() => this.toggleBRBMode()}
                >
                    {active ? "Return from AFK" : "Be Right Back"}
                </div>
            );
        };
        
        MessageActions.addButton("brb-button", BRBButton);
    },

    // Toggle BRB mode on/off
    toggleBRBMode() {
        if (this.settings.isActive) {
            this.deactivateBRBMode(true);
        } else {
            this.activateBRBMode();
        }
    },

    // Activate BRB mode
    activateBRBMode() {
        const currentUser = UserStore.getCurrentUser();
        if (!currentUser) return;

        // Save current status before changing it
        if (this.settings.savePreviousStatus) {
            const currentStatus = StatusStore.getStatus(currentUser.id);
            const currentCustomStatus = UserSettingsStore.status.customStatus;
            
            this.settings.previousStatus = {
                status: currentStatus,
                customStatus: currentCustomStatus ? {
                    text: currentCustomStatus.text,
                    emoji: currentCustomStatus.emoji_name
                } : null
            };
        }

        // Set away status
        setStatus("idle");
        setCustomStatus(this.settings.customStatusText, "🔕");

        // Store channel notification settings before muting
        this.storeChannelSettings();
        
        // Mute all channels except the ones in settings.unmutedChannels
        this.muteAllChannelsExcept(this.settings.unmutedChannels);

        // Start collecting messages for digest
        this.startCollectingMessages();

        // Update settings
        this.settings.isActive = true;
        this.settings.timeAway = Date.now();
        saveSettings(this.settings);
    },

    // Deactivate BRB mode
    deactivateBRBMode(showDigest: boolean) {
        // Reset status
        if (this.settings.savePreviousStatus && this.settings.previousStatus) {
            resetStatus(this.settings.previousStatus.status, this.settings.previousStatus.customStatus);
        } else {
            resetStatus();
        }

        // Restore channel notification settings
        this.restoreChannelSettings();

        // Stop collecting messages and generate digest
        const digest = this.stopCollectingMessages();
        
        // Update settings
        this.settings.isActive = false;
        saveSettings(this.settings);

        // Show digest if enabled and requested
        if (showDigest && this.settings.showDigestOnReturn && digest) {
            this.showDigest(digest);
        }
    },

    // Message listener for collecting messages while away
    onMessageCreate(message: any) {
        if (!this.isCollectingMessages || !this.digestData) return;
        
        const currentUser = UserStore.getCurrentUser();
        if (!currentUser) return;
        
        // Collect mentions
        if (message.mentions?.includes(currentUser.id)) {
            this.digestData.mentions.push(message);
        }
        
        // Collect everyone mentions
        if (message.mentionEveryone) {
            this.digestData.everyoneMentions.push(message);
        }
        
        // Collect DMs
        if (message.channel_id && ChannelStore.getChannel(message.channel_id)?.type === 1) {
            this.digestData.directMessages.push(message);
        }
        
        // Collect messages from unmuted channels
        if (this.settings.unmutedChannels.includes(message.channel_id)) {
            if (!this.digestData.unmutedChannelMessages[message.channel_id]) {
                this.digestData.unmutedChannelMessages[message.channel_id] = [];
            }
            this.digestData.unmutedChannelMessages[message.channel_id].push(message);
        }
    },

    // Store original channel notification settings before muting
    storeChannelSettings() {
        this.originalChannelSettings = {};
        const channels = ChannelStore.getGuildChannels ? 
            Object.values(ChannelStore.getGuildChannels()) : 
            Object.values(ChannelStore.getAllChannels());
            
        for (const channel of channels) {
            const settings = NotificationSettingsStore.getChannelOverrides(channel.guild_id, channel.id);
            if (settings) {
                this.originalChannelSettings[channel.id] = { ...settings };
            }
        }
    },

    // Mute all channels except those specified
    muteAllChannelsExcept(unmutedChannelIds: string[]) {
        const channels = ChannelStore.getGuildChannels ? 
            Object.values(ChannelStore.getGuildChannels()) : 
            Object.values(ChannelStore.getAllChannels());
            
        for (const channel of channels) {
            if (!unmutedChannelIds.includes(channel.id)) {
                NotificationActions.updateChannelOverrideSettings(
                    channel.guild_id,
                    channel.id,
                    { muted: true }
                );
            }
        }
    },

    // Restore original channel notification settings
    restoreChannelSettings() {
        for (const channelId in this.originalChannelSettings) {
            const channel = ChannelStore.getChannel(channelId);
            if (channel) {
                NotificationActions.updateChannelOverrideSettings(
                    channel.guild_id,
                    channel.id,
                    this.originalChannelSettings[channelId]
                );
            }
        }
        this.originalChannelSettings = {};
    },

    // Start collecting messages for digest
    startCollectingMessages() {
        this.digestData = {
            mentions: [],
            unmutedChannelMessages: {},
            directMessages: [],
            everyoneMentions: [],
            startTime: Date.now()
        };
        this.isCollectingMessages = true;
    },

    // Stop collecting messages and return digest data
    stopCollectingMessages() {
        this.isCollectingMessages = false;
        const digest = this.digestData;
        this.digestData = null;
        return digest;
    },

    // Format time duration for display
    formatTimeDuration(ms: number): string {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        
        if (hours > 0) {
            return `${hours}h ${minutes % 60}m`;
        } else if (minutes > 0) {
            return `${minutes}m ${seconds % 60}s`;
        } else {
            return `${seconds}s`;
        }
    },

    // Show message digest to user
    showDigest(digestData: DigestData) {
        if (!digestData) return;
        
        const Modal = findByProps("openModal", "closeAllModals");
        if (!Modal) {
            console.error("[BRBMode] Modal module not found");
            return;
        }
        
        const getChannelName = (channelId: string) => {
            const channel = ChannelStore.getChannel(channelId);
            if (!channel) return "Unknown Channel";
            
            if (channel.type === 1) { // DM
                const recipient = UserStore.getUser(channel.recipients?.[0]);
                return recipient ? recipient.username : "Unknown User";
            }
            
            // Guild channel
            const guildName = channel.guild_id ? 
                GuildStore.getGuild(channel.guild_id)?.name + " / " : 
                "";
            return guildName + (channel.name || "Unknown Channel");
        };

        const getUserName = (userId: string) => {
            const user = UserStore.getUser(userId);
            return user ? user.username : "Unknown User";
        };
        
        const DigestModal = (props) => {
            const [selectedTab, setSelectedTab] = React.useState("overview");
            
            const formatter = new Intl.DateTimeFormat(navigator.language, {
                hour: 'numeric',
                minute: 'numeric'
            });
            
            // Count total messages across all categories
            const totalMessages = 
                digestData.mentions.length + 
                digestData.directMessages.length + 
                digestData.everyoneMentions.length + 
                Object.values(digestData.unmutedChannelMessages).reduce((sum, msgs) => sum + msgs.length, 0);
                
            // Format message content (truncate long messages)
            const formatMessage = (content: string, maxLength = 100) => {
                if (!content) return "[No text content]";
                if (content.length <= maxLength) return content;
                return content.slice(0, maxLength) + "...";
            };
            
            const renderOverview = () => (
                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                    <h3>Message Digest Summary</h3>
                    <div>You were away for {this.formatTimeDuration(Date.now() - digestData.startTime)}.</div>
                    <div>Total messages received: {totalMessages}</div>
                    
                    {digestData.mentions.length > 0 && (
                        <div style={{ marginBottom: "16px", paddingBottom: "12px", borderBottom: "1px solid #4f545c" }}>
                            <h4>You were mentioned {digestData.mentions.length} times</h4>
                            {this.settings.digestFormat === "detailed" && digestData.mentions.slice(0, 3).map((msg, i) => (
                                <div key={i} style={{ padding: "8px", marginBottom: "6px", backgroundColor: "#2f3136", borderRadius: "4px" }}>
                                    <div style={{ fontWeight: "bold" }}>
                                        {getUserName(msg.author.id)} in {getChannelName(msg.channel_id)}:
                                    </div>
                                    <div>{formatMessage(msg.content)}</div>
                                </div>
                            ))}
                            {digestData.mentions.length > 3 && this.settings.digestFormat === "detailed" && (
                                <div style={{ fontStyle: "italic" }}>
                                    +{digestData.mentions.length - 3} more mentions
                                </div>
                            )}
                        </div>
                    )}
                    
                    {digestData.directMessages.length > 0 && (
                        <div style={{ marginBottom: "16px", paddingBottom: "12px", borderBottom: "1px solid #4f545c" }}>
                            <h4>You received {digestData.directMessages.length} direct messages</h4>
                            {this.settings.digestFormat === "detailed" && digestData.directMessages.slice(0, 3).map((msg, i) => (
                                <div key={i} style={{ padding: "8px", marginBottom: "6px", backgroundColor: "#2f3136", borderRadius: "4px" }}>
                                    <div style={{ fontWeight: "bold" }}>
                                        {getUserName(msg.author.id)}:
                                    </div>
                                    <div>{formatMessage(msg.content)}</div>
                                </div>
                            ))}
                            {digestData.directMessages.length > 3 && this.settings.digestFormat === "detailed" && (
                                <div style={{ fontStyle: "italic" }}>
                                    +{digestData.directMessages.length - 3} more direct messages
                                </div>
                            )}
                        </div>
                    )}
                    
                    {digestData.everyoneMentions.length > 0 && (
                        <div style={{ marginBottom: "16px", paddingBottom: "12px", borderBottom: "1px solid #4f545c" }}>
                            <h4>There were {digestData.everyoneMentions.length} @everyone mentions</h4>
                            {this.settings.digestFormat === "detailed" && digestData.everyoneMentions.slice(0, 2).map((msg, i) => (
                                <div key={i} style={{ padding: "8px", marginBottom: "6px", backgroundColor: "#2f3136", borderRadius: "4px" }}>
                                    <div style={{ fontWeight: "bold" }}>
                                        {getUserName(msg.author.id)} in {getChannelName(msg.channel_id)}:
                                    </div>
                                    <div>{formatMessage(msg.content)}</div>
                                </div>
                            ))}
                        </div>
                    )}
                    
                    {Object.keys(digestData.unmutedChannelMessages).length > 0 && (
                        <div style={{ marginBottom: "16px" }}>
                            <h4>Activity in unmuted channels:</h4>
                            {Object.entries(digestData.unmutedChannelMessages).map(([channelId, messages]) => (
                                <div key={channelId} style={{ padding: "8px", marginBottom: "6px", backgroundColor: "#2f3136", borderRadius: "4px" }}>
                                    <div>{getChannelName(channelId)}: {messages.length} messages</div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            );
            
            const renderContent = () => {
                switch (selectedTab) {
                    default: return renderOverview();
                }
            };
            
            return (
                <div style={{ padding: "20px", maxWidth: "600px", maxHeight: "80vh", overflow: "auto" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                        <h2>BRB Mode Message Digest</h2>
                        <div style={{ cursor: "pointer" }} onClick={props.onClose}>✕</div>
                    </div>
                    
                    {renderContent()}
                    
                    <div style={{ marginTop: "20px", display: "flex", justifyContent: "flex-end" }}>
                        <button 
                            onClick={props.onClose}
                            style={{ 
                                padding: "8px 16px", 
                                background: "#5865f2", 
                                color: "white",
                                border: "none",
                                borderRadius: "3px",
                                cursor: "pointer"
                            }}
                        >
                            Close
                        </button>
                    </div>
                </div>
            );
        };
        
        Modal.openModal(props => <DigestModal {...props} />);
    }
});
