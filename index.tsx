// BRB Mode Plugin for Vencord
// A standalone plugin that needs minimal integration

export default {
    name: "BRBMode",
    description: "Enables a 'Be Right Back' mode with custom status, channel muting, and message digests",
    authors: [{ name: "Vencord User" }],
    
    // Plugin data
    settings: {
        isActive: false,
        customStatusText: "AFK - Be Right Back",
        unmutedChannels: [],
        digestFormat: "detailed",
        savePreviousStatus: true,
        previousStatus: null,
        showDigestOnReturn: true,
        timeAway: 0
    },
    digestData: null,
    originalChannelSettings: {},
    isCollectingMessages: false,
    
    // Cache for required Discord modules
    modules: {
        webpack: null,
        userStore: null,
        statusStore: null,
        channelStore: null,
        guildStore: null,
        messageStore: null,
        notificationSettings: null,
        notificationActions: null,
        flux: null,
        react: null,
        modal: null
    },
    
    // Helper to find modules
    getModule(filter) {
        if (!window.webpackChunkdiscord_app) return null;
        
        for (const m of Object.values(window.webpackChunkdiscord_app.push([[Symbol()], {}, m => m]))) {
            const mod = m?.exports;
            if (mod && filter(mod)) return mod;
        }
        return null;
    },
    
    getModuleByProps(...props) {
        return this.getModule(m => props.every(prop => prop in m));
    },
    
    getStore(name) {
        return this.getModule(m => m?.default?.getName?.() === name)?.default;
    },
    
    // Load required Discord modules
    loadModules() {
        this.modules.webpack = {
            getByProps: (...props) => this.getModuleByProps(...props),
            getStore: (name) => this.getStore(name)
        };
        
        this.modules.userStore = this.getStore("UserStore");
        this.modules.statusStore = this.getStore("StatusStore");
        this.modules.channelStore = this.getStore("ChannelStore");
        this.modules.guildStore = this.getStore("GuildStore");
        this.modules.messageStore = this.getStore("MessageStore");
        this.modules.userSettingsStore = this.getStore("UserSettingsStore");
        this.modules.notificationSettings = this.getStore("NotificationSettingsStore");
        
        this.modules.notificationActions = this.getModuleByProps("updateChannelOverrideSettings");
        this.modules.flux = this.getModuleByProps("dispatch", "subscribe");
        this.modules.react = this.getModuleByProps("useState", "useEffect");
        this.modules.modal = this.getModuleByProps("openModal", "closeAllModals");
        
        return Object.values(this.modules).every(m => m !== null);
    },
    
    // Plugin lifecycle methods
    start() {
        console.log("[BRBMode] Starting plugin...");
        
        // Load required modules
        if (!this.loadModules()) {
            console.error("[BRBMode] Failed to load required modules");
            return;
        }
        
        // Check if the plugin was enabled when Discord was closed and reset if needed
        if (this.settings.isActive) {
            this.settings.isActive = false;
        }
        
        // Register message listener for collecting messages when away
        this.modules.flux.subscribe("MESSAGE_CREATE", this.onMessageCreate.bind(this));
        
        // Add BRB button to status menu
        this.addBRBButton();
        
        console.log("[BRBMode] Plugin started successfully");
    },
    
    stop() {
        console.log("[BRBMode] Stopping plugin...");
        
        // If BRB mode is active when plugin is disabled, reset status
        if (this.settings.isActive) {
            this.deactivateBRBMode(false);
        }
        
        // Unregister listeners and remove button
        if (this.modules.flux) {
            this.modules.flux.unsubscribe("MESSAGE_CREATE", this.onMessageCreate.bind(this));
        }
        
        // Remove button
        const statusBar = document.querySelector('[class*="status-"]');
        const brbButton = document.getElementById('brb-button');
        if (brbButton) brbButton.remove();
        
        console.log("[BRBMode] Plugin stopped successfully");
    },
    
    // Add BRB button to Discord's status menu
    addBRBButton() {
        // Check if button already exists
        if (document.getElementById('brb-button')) return;
        
        // Find status picker or any good place to add the button
        const statusBar = document.querySelector('[class*="status-"]');
        if (!statusBar) {
            console.error("[BRBMode] Could not find status bar to add button");
            setTimeout(() => this.addBRBButton(), 2000); // Retry after 2 seconds
            return;
        }
        
        // Create button element
        const button = document.createElement('div');
        button.id = 'brb-button';
        button.className = 'brb-button' + (this.settings.isActive ? ' brb-active' : '');
        button.textContent = this.settings.isActive ? "Return from AFK" : "Be Right Back";
        button.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 8px 12px;
            border-radius: 4px;
            margin: 8px;
            cursor: pointer;
            font-weight: 500;
            transition: background-color 0.2s, color 0.2s;
            background-color: ${this.settings.isActive ? '#f04747' : '#2f3136'};
            color: ${this.settings.isActive ? 'white' : '#dcddde'};
        `;
        
        // Add click handler
        button.onclick = this.toggleBRBMode.bind(this);
        
        // Add button to status bar or any other good place
        statusBar.parentElement.appendChild(button);
    },
    
    // Toggle BRB mode on/off
    toggleBRBMode() {
        if (this.settings.isActive) {
            this.deactivateBRBMode(true);
        } else {
            this.activateBRBMode();
        }
        
        // Update button appearance
        const button = document.getElementById('brb-button');
        if (button) {
            button.className = 'brb-button' + (this.settings.isActive ? ' brb-active' : '');
            button.textContent = this.settings.isActive ? "Return from AFK" : "Be Right Back";
            button.style.backgroundColor = this.settings.isActive ? '#f04747' : '#2f3136';
            button.style.color = this.settings.isActive ? 'white' : '#dcddde';
        }
    },
    
    // Set user status
    setStatus(status) {
        const StatusModule = this.getModuleByProps("updateStatus");
        if (!StatusModule) {
            console.error("[BRBMode] Status module not found");
            return;
        }
        
        StatusModule.updateStatus(status);
    },
    
    // Set custom status text and emoji
    setCustomStatus(text, emoji) {
        const CustomStatusModule = this.getModuleByProps("updateRemoteSettings");
        if (!CustomStatusModule) {
            console.error("[BRBMode] Custom status module not found");
            return;
        }
        
        const customStatus = { text: text || "" };
        
        if (emoji) {
            customStatus.emoji_name = emoji;
        }
        
        CustomStatusModule.updateRemoteSettings({ customStatus });
    },
    
    // Reset status to previous or default
    resetStatus(status = "online", customStatus = null) {
        this.setStatus(status);
        
        if (customStatus) {
            this.setCustomStatus(customStatus.text, customStatus.emoji);
        } else {
            this.getModuleByProps("updateRemoteSettings").updateRemoteSettings({
                customStatus: null
            });
        }
    },
    
    // Activate BRB mode
    activateBRBMode() {
        const currentUser = this.modules.userStore.getCurrentUser();
        if (!currentUser) return;
        
        // Save current status before changing it
        if (this.settings.savePreviousStatus) {
            const currentStatus = this.modules.statusStore.getStatus(currentUser.id);
            const currentCustomStatus = this.modules.userSettingsStore.status.customStatus;
            
            this.settings.previousStatus = {
                status: currentStatus,
                customStatus: currentCustomStatus ? {
                    text: currentCustomStatus.text,
                    emoji: currentCustomStatus.emoji_name
                } : null
            };
        }
        
        // Set away status
        this.setStatus("idle");
        this.setCustomStatus(this.settings.customStatusText, "🔕");
        
        // Store channel notification settings before muting
        this.storeChannelSettings();
        
        // Mute all channels except the ones in settings.unmutedChannels
        this.muteAllChannelsExcept(this.settings.unmutedChannels);
        
        // Start collecting messages for digest
        this.startCollectingMessages();
        
        // Update settings
        this.settings.isActive = true;
        this.settings.timeAway = Date.now();
    },
    
    // Deactivate BRB mode
    deactivateBRBMode(showDigest) {
        // Reset status
        if (this.settings.savePreviousStatus && this.settings.previousStatus) {
            this.resetStatus(
                this.settings.previousStatus.status,
                this.settings.previousStatus.customStatus
            );
        } else {
            this.resetStatus();
        }
        
        // Restore channel notification settings
        this.restoreChannelSettings();
        
        // Stop collecting messages and generate digest
        const digest = this.stopCollectingMessages();
        
        // Update settings
        this.settings.isActive = false;
        
        // Show digest if enabled and requested
        if (showDigest && this.settings.showDigestOnReturn && digest) {
            this.showDigest(digest);
        }
    },
    
    // Message listener for collecting messages while away
    onMessageCreate(message) {
        if (!this.isCollectingMessages || !this.digestData) return;
        
        const currentUser = this.modules.userStore.getCurrentUser();
        if (!currentUser) return;
        
        try {
            // Collect mentions
            if (message.mentions?.includes(currentUser.id)) {
                this.digestData.mentions.push(message);
            }
            
            // Collect everyone mentions
            if (message.mentionEveryone) {
                this.digestData.everyoneMentions.push(message);
            }
            
            // Collect DMs
            if (message.channel_id && this.modules.channelStore.getChannel(message.channel_id)?.type === 1) {
                this.digestData.directMessages.push(message);
            }
            
            // Collect messages from unmuted channels
            if (this.settings.unmutedChannels.includes(message.channel_id)) {
                if (!this.digestData.unmutedChannelMessages[message.channel_id]) {
                    this.digestData.unmutedChannelMessages[message.channel_id] = [];
                }
                this.digestData.unmutedChannelMessages[message.channel_id].push(message);
            }
        } catch (error) {
            console.error("[BRBMode] Error processing message:", error);
        }
    },
    
    // Store original channel notification settings before muting
    storeChannelSettings() {
        this.originalChannelSettings = {};
        
        try {
            const channels = this.modules.channelStore.getGuildChannels ? 
                Object.values(this.modules.channelStore.getGuildChannels()) : 
                Object.values(this.modules.channelStore.getAllChannels());
                
            for (const channel of channels) {
                if (!channel.guild_id) continue;
                
                const settings = this.modules.notificationSettings.getChannelOverrides(channel.guild_id, channel.id);
                if (settings) {
                    this.originalChannelSettings[channel.id] = { ...settings };
                }
            }
        } catch (error) {
            console.error("[BRBMode] Error storing channel settings:", error);
        }
    },
    
    // Mute all channels except those specified
    muteAllChannelsExcept(unmutedChannelIds) {
        try {
            const channels = this.modules.channelStore.getGuildChannels ? 
                Object.values(this.modules.channelStore.getGuildChannels()) : 
                Object.values(this.modules.channelStore.getAllChannels());
                
            for (const channel of channels) {
                if (!channel.guild_id) continue;
                
                if (!unmutedChannelIds.includes(channel.id)) {
                    this.modules.notificationActions.updateChannelOverrideSettings(
                        channel.guild_id,
                        channel.id,
                        { muted: true }
                    );
                }
            }
        } catch (error) {
            console.error("[BRBMode] Error muting channels:", error);
        }
    },
    
    // Restore original channel notification settings
    restoreChannelSettings() {
        try {
            for (const channelId in this.originalChannelSettings) {
                const channel = this.modules.channelStore.getChannel(channelId);
                if (channel && channel.guild_id) {
                    this.modules.notificationActions.updateChannelOverrideSettings(
                        channel.guild_id,
                        channel.id,
                        this.originalChannelSettings[channelId]
                    );
                }
            }
            this.originalChannelSettings = {};
        } catch (error) {
            console.error("[BRBMode] Error restoring channel settings:", error);
        }
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
    formatTimeDuration(ms) {
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
    
    // Show message digest to user using simple DOM manipulation
    showDigest(digestData) {
        if (!digestData) return;
        
        try {
            // Create overlay
            const overlay = document.createElement('div');
            overlay.className = 'brb-digest-overlay';
            overlay.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.7);
                z-index: 9999;
            `;
            
            // Create modal
            const modal = document.createElement('div');
            modal.className = 'brb-digest-modal';
            modal.style.cssText = `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: var(--background-primary, #36393f);
                border-radius: 8px;
                padding: 16px;
                width: 80%;
                max-width: 600px;
                max-height: 80vh;
                overflow-y: auto;
                z-index: 10000;
                box-shadow: 0 0 0 1px rgba(32,34,37,.6), 0 2px 10px 0 rgba(0,0,0,.2);
            `;
            
            // Create header
            const header = document.createElement('div');
            header.style.cssText = `
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 16px;
                padding-bottom: 8px;
                border-bottom: 1px solid var(--background-modifier-accent, #4f545c);
            `;
            
            const title = document.createElement('h2');
            title.textContent = 'BRB Mode Message Digest';
            title.style.cssText = `
                font-size: 20px;
                font-weight: bold;
                color: var(--header-primary, #fff);
                margin: 0;
            `;
            
            const closeButton = document.createElement('div');
            closeButton.textContent = '✕';
            closeButton.style.cssText = `
                cursor: pointer;
                color: var(--interactive-normal, #b9bbbe);
            `;
            closeButton.onclick = () => overlay.remove();
            
            header.appendChild(title);
            header.appendChild(closeButton);
            
            // Create content
            const content = document.createElement('div');
            content.style.cssText = `
                margin-bottom: 16px;
            `;
            
            // Time away section
            const timeAwayText = document.createElement('div');
            timeAwayText.textContent = `You were away for ${this.formatTimeDuration(Date.now() - digestData.startTime)}.`;
            timeAwayText.style.cssText = `
                margin-bottom: 16px;
            `;
            content.appendChild(timeAwayText);
            
            const totalMsgsText = document.createElement('div');
            const totalMsgs = 
                digestData.mentions.length + 
                digestData.directMessages.length + 
                digestData.everyoneMentions.length + 
                Object.values(digestData.unmutedChannelMessages).reduce((sum, msgs) => sum + msgs.length, 0);
            totalMsgsText.textContent = `Total messages: ${totalMsgs}`;
            totalMsgsText.style.cssText = `
                margin-bottom: 16px;
            `;
            content.appendChild(totalMsgsText);
            
            // Helper function to get names
            const getChannelName = (channelId) => {
                const channel = this.modules.channelStore.getChannel(channelId);
                if (!channel) return "Unknown Channel";
                
                if (channel.type === 1) { // DM
                    const recipient = this.modules.userStore.getUser(channel.recipients?.[0]);
                    return recipient ? recipient.username : "Unknown User";
                }
                
                // Guild channel
                const guildName = channel.guild_id ? 
                    this.modules.guildStore.getGuild(channel.guild_id)?.name + " / " : 
                    "";
                return guildName + (channel.name || "Unknown Channel");
            };

            const getUserName = (userId) => {
                const user = this.modules.userStore.getUser(userId);
                return user ? user.username : "Unknown User";
            };
            
            // Format message content
            const formatMessage = (content, maxLength = 100) => {
                if (!content) return "[No text content]";
                if (content.length <= maxLength) return content;
                return content.slice(0, maxLength) + "...";
            };
            
            // Mentions section
            if (digestData.mentions.length > 0) {
                const mentionsSection = document.createElement('div');
                mentionsSection.style.cssText = `
                    margin-bottom: 16px;
                    padding-bottom: 12px;
                    border-bottom: 1px solid var(--background-modifier-accent, #4f545c);
                `;
                
                const mentionsTitle = document.createElement('h3');
                mentionsTitle.textContent = `You were mentioned ${digestData.mentions.length} times`;
                mentionsTitle.style.cssText = `
                    font-size: 16px;
                    font-weight: bold;
                    margin-bottom: 8px;
                `;
                mentionsSection.appendChild(mentionsTitle);
                
                // Add up to 3 mentions in detailed format
                digestData.mentions.slice(0, 3).forEach(msg => {
                    const messageDiv = document.createElement('div');
                    messageDiv.style.cssText = `
                        padding: 8px;
                        margin-bottom: 6px;
                        background-color: var(--background-secondary, #2f3136);
                        border-radius: 4px;
                    `;
                    
                    const author = document.createElement('div');
                    author.style.cssText = `
                        font-weight: bold;
                        margin-bottom: 4px;
                    `;
                    author.textContent = `${getUserName(msg.author.id)} in ${getChannelName(msg.channel_id)}:`;
                    messageDiv.appendChild(author);
                    
                    const msgContent = document.createElement('div');
                    msgContent.textContent = formatMessage(msg.content || '[No content]');
                    messageDiv.appendChild(msgContent);
                    
                    mentionsSection.appendChild(messageDiv);
                });
                
                // If more than 3 mentions, show count of remaining
                if (digestData.mentions.length > 3) {
                    const more = document.createElement('div');
                    more.textContent = `+ ${digestData.mentions.length - 3} more mentions`;
                    more.style.cssText = `
                        font-style: italic;
                        margin-top: 8px;
                    `;
                    mentionsSection.appendChild(more);
                }
                
                content.appendChild(mentionsSection);
            }
            
            // DMs section
            if (digestData.directMessages.length > 0) {
                const dmsSection = document.createElement('div');
                dmsSection.style.cssText = `
                    margin-bottom: 16px;
                    padding-bottom: 12px;
                    border-bottom: 1px solid var(--background-modifier-accent, #4f545c);
                `;
                
                const dmsTitle = document.createElement('h3');
                dmsTitle.textContent = `You received ${digestData.directMessages.length} direct messages`;
                dmsTitle.style.cssText = `
                    font-size: 16px;
                    font-weight: bold;
                    margin-bottom: 8px;
                `;
                dmsSection.appendChild(dmsTitle);
                
                // Add up to 3 DMs in detailed format
                digestData.directMessages.slice(0, 3).forEach(msg => {
                    const messageDiv = document.createElement('div');
                    messageDiv.style.cssText = `
                        padding: 8px;
                        margin-bottom: 6px;
                        background-color: var(--background-secondary, #2f3136);
                        border-radius: 4px;
                    `;
                    
                    const author = document.createElement('div');
                    author.style.cssText = `
                        font-weight: bold;
                        margin-bottom: 4px;
                    `;
                    author.textContent = getUserName(msg.author.id);
                    messageDiv.appendChild(author);
                    
                    const msgContent = document.createElement('div');
                    msgContent.textContent = formatMessage(msg.content || '[No content]');
                    messageDiv.appendChild(msgContent);
                    
                    dmsSection.appendChild(messageDiv);
                });
                
                // If more than 3 DMs, show count of remaining
                if (digestData.directMessages.length > 3) {
                    const more = document.createElement('div');
                    more.textContent = `+ ${digestData.directMessages.length - 3} more direct messages`;
                    more.style.cssText = `
                        font-style: italic;
                        margin-top: 8px;
                    `;
                    dmsSection.appendChild(more);
                }
                
                content.appendChild(dmsSection);
            }
            
            // Everyone mentions
            if (digestData.everyoneMentions.length > 0) {
                const everyoneSection = document.createElement('div');
                everyoneSection.style.cssText = `
                    margin-bottom: 16px;
                    padding-bottom: 12px;
                    border-bottom: 1px solid var(--background-modifier-accent, #4f545c);
                `;
                
                const everyoneTitle = document.createElement('h3');
                everyoneTitle.textContent = `There were ${digestData.everyoneMentions.length} @everyone mentions`;
                everyoneTitle.style.cssText = `
                    font-size: 16px;
                    font-weight: bold;
                    margin-bottom: 8px;
                `;
                everyoneSection.appendChild(everyoneTitle);
                
                // Add up to 3 everyone mentions in detailed format
                digestData.everyoneMentions.slice(0, 3).forEach(msg => {
                    const messageDiv = document.createElement('div');
                    messageDiv.style.cssText = `
                        padding: 8px;
                        margin-bottom: 6px;
                        background-color: var(--background-secondary, #2f3136);
                        border-radius: 4px;
                    `;
                    
                    const author = document.createElement('div');
                    author.style.cssText = `
                        font-weight: bold;
                        margin-bottom: 4px;
                    `;
                    author.textContent = `${getUserName(msg.author.id)} in ${getChannelName(msg.channel_id)}`;
                    messageDiv.appendChild(author);
                    
                    everyoneSection.appendChild(messageDiv);
                });
                
                content.appendChild(everyoneSection);
            }
            
            // Unmuted channels activity
            if (Object.keys(digestData.unmutedChannelMessages).length > 0) {
                const unmutedSection = document.createElement('div');
                unmutedSection.style.cssText = `
                    margin-bottom: 16px;
                `;
                
                const unmutedTitle = document.createElement('h3');
                unmutedTitle.textContent = 'Activity in unmuted channels:';
                unmutedTitle.style.cssText = `
                    font-size: 16px;
                    font-weight: bold;
                    margin-bottom: 8px;
                `;
                unmutedSection.appendChild(unmutedTitle);
                
                // Show activity counts for each unmuted channel
                Object.entries(digestData.unmutedChannelMessages).forEach(([channelId, messages]) => {
                    const channelDiv = document.createElement('div');
                    channelDiv.style.cssText = `
                        padding: 8px;
                        margin-bottom: 6px;
                        background-color: var(--background-secondary, #2f3136);
                        border-radius: 4px;
                    `;
                    
                    channelDiv.textContent = `${getChannelName(channelId)}: ${messages.length} messages`;
                    unmutedSection.appendChild(channelDiv);
                });
                
                content.appendChild(unmutedSection);
            }
            
            // Add footer with close button
            const footer = document.createElement('div');
            footer.style.cssText = `
                display: flex;
                justify-content: flex-end;
            `;
            
            const closeBtn = document.createElement('button');
            closeBtn.textContent = 'Close';
            closeBtn.style.cssText = `
                padding: 8px 16px;
                background-color: var(--brand-experiment, #5865f2);
                color: white;
                border: none;
                border-radius: 3px;
                cursor: pointer;
            `;
            closeBtn.onclick = () => overlay.remove();
            
            footer.appendChild(closeBtn);
            
            // Assemble the modal
            modal.appendChild(header);
            modal.appendChild(content);
            modal.appendChild(footer);
            overlay.appendChild(modal);
            
            // Add to document
            document.body.appendChild(overlay);
        } catch (error) {
            console.error("[BRBMode] Error showing digest:", error);
        }
    },
    
    // Simple settings UI
    settingsComponent() {
        return this.modules.react.createElement("div", null, 
            this.modules.react.createElement("h2", null, "BRB Mode Settings"),
            
            this.modules.react.createElement("div", { style: { marginBottom: "16px" } },
                this.modules.react.createElement("h3", null, "BRB Status"),
                this.modules.react.createElement("p", null, "Current status: " + (this.settings.isActive ? "Active (Away)" : "Inactive")),
                this.modules.react.createElement("button", {
                    onClick: this.toggleBRBMode.bind(this),
                    style: {
                        padding: "8px 16px",
                        background: this.settings.isActive ? "#f04747" : "#43b581",
                        color: "white",
                        border: "none",
                        borderRadius: "3px",
                        cursor: "pointer"
                    }
                }, this.settings.isActive ? "Deactivate BRB Mode" : "Activate BRB Mode")
            ),
            
            this.modules.react.createElement("div", { style: { marginBottom: "16px" } },
                this.modules.react.createElement("h3", null, "Custom Status Text"),
                this.modules.react.createElement("p", null, "Custom status message to display when you're away"),
                this.modules.react.createElement("input", {
                    type: "text",
                    value: this.settings.customStatusText,
                    onChange: e => {
                        this.settings.customStatusText = e.target.value;
                    },
                    placeholder: "AFK, be right back...",
                    style: {
                        width: "100%",
                        padding: "8px",
                        background: "#2f3136",
                        border: "none",
                        borderRadius: "3px",
                        color: "#dcddde"
                    }
                })
            ),
            
            this.modules.react.createElement("div", { style: { marginBottom: "16px" } },
                this.modules.react.createElement("h3", null, "Digest Format"),
                this.modules.react.createElement("p", null, "Choose how detailed your message digest will be when you return"),
                this.modules.react.createElement("div", { style: { display: "flex", flexDirection: "column", gap: "8px" } },
                    this.modules.react.createElement("label", { style: { display: "flex", alignItems: "center" } },
                        this.modules.react.createElement("input", {
                            type: "radio",
                            checked: this.settings.digestFormat === "short",
                            onChange: () => {
                                this.settings.digestFormat = "short";
                            },
                            style: { marginRight: "8px" }
                        }),
                        "Short Summary"
                    ),
                    this.modules.react.createElement("label", { style: { display: "flex", alignItems: "center" } },
                        this.modules.react.createElement("input", {
                            type: "radio",
                            checked: this.settings.digestFormat === "detailed",
                            onChange: () => {
                                this.settings.digestFormat = "detailed";
                            },
                            style: { marginRight: "8px" }
                        }),
                        "Detailed Digest"
                    )
                )
            ),
            
            this.modules.react.createElement("div", { style: { marginBottom: "8px" } },
                this.modules.react.createElement("label", { style: { display: "flex", alignItems: "center" } },
                    this.modules.react.createElement("input", {
                        type: "checkbox",
                        checked: this.settings.savePreviousStatus,
                        onChange: () => {
                            this.settings.savePreviousStatus = !this.settings.savePreviousStatus;
                        },
                        style: { marginRight: "8px" }
                    }),
                    "Save Previous Status (Remember and restore your previous status)"
                )
            ),
            
            this.modules.react.createElement("div", null,
                this.modules.react.createElement("label", { style: { display: "flex", alignItems: "center" } },
                    this.modules.react.createElement("input", {
                        type: "checkbox",
                        checked: this.settings.showDigestOnReturn,
                        onChange: () => {
                            this.settings.showDigestOnReturn = !this.settings.showDigestOnReturn;
                        },
                        style: { marginRight: "8px" }
                    }),
                    "Show Digest On Return (Show message digest automatically when you return)"
                )
            )
        );
    }
};
