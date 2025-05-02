import { webpack } from "@webpack";
import { Devs } from "@utils/constants";
import { definePlugin, types } from "@utils/types";
import { findStoreLazy, findByPropsLazy } from "@webpack";
import { addButton, removeButton } from "@api/MessageActions";
import { React, FluxDispatcher } from "@webpack/common";
import Settings from "./components/Settings";
import Digest from "./components/Digest";
import { saveSettings, loadSettings, getDefaultSettings } from "./util/storageUtils";
import { setStatus, setCustomStatus, resetStatus } from "./util/statusUtils";
import { getMutedChannelMessages, getAllMentions } from "./util/messageUtils";
import "./styles.css";

// Define lazy-loaded Discord stores and modules
const UserSettingsStore = findStoreLazy("UserSettingsStore");
const ChannelStore = findStoreLazy("ChannelStore");
const GuildStore = findStoreLazy("GuildStore");
const UserStore = findStoreLazy("UserStore");
const MessageStore = findStoreLazy("MessageStore");
const StatusStore = findStoreLazy("StatusStore");
const NotificationSettingsStore = findStoreLazy("NotificationSettingsStore");

const NotificationActions = findByPropsLazy("updateChannelOverrideSettings");
const SelectedChannelStore = findStoreLazy("SelectedChannelStore");

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

export default definePlugin({
    name: "BRBMode",
    description: "Enables a 'Be Right Back' mode with custom status, channel muting, and message digests",
    authors: [{ name: "Vencord User", id: 0n }],
    dependencies: ["MessageAccessories", "NotificationSettings"],

    // Plugin data
    settings: getDefaultSettings() as BRBSettings,
    digestData: null as DigestData | null,
    originalChannelSettings: {} as Record<string, any>,
    isCollectingMessages: false,

    // Define plugin settings component
    settingsAboutComponent: () => <p>Configure the "Be Right Back" mode settings</p>,
    settingsComponent() {
        return (
            <Settings
                settings={this.settings}
                onUpdate={(newSettings) => {
                    this.settings = { ...this.settings, ...newSettings };
                    saveSettings(this.settings);
                }}
                onToggleBRB={this.toggleBRBMode.bind(this)}
            />
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
        removeButton("brb-button");
    },

    // Add BRB button to Discord's status menu
    addBRBButton() {
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
                    className={`brb-button ${active ? 'brb-active' : ''}`}
                    onClick={() => this.toggleBRBMode()}
                >
                    {active ? "Return from AFK" : "Be Right Back"}
                </div>
            );
        };
        
        addButton("brb-button", BRBButton);
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

    // Show message digest to user
    showDigest(digestData: DigestData) {
        const DigestModal = () => (
            <Digest 
                digestData={digestData} 
                format={this.settings.digestFormat}
                timeAway={Date.now() - digestData.startTime}
            />
        );
        
        webpack.getByProps("openModal", "closeAllModals").openModal(modalProps => 
            <DigestModal {...modalProps} />
        );
    }
});
