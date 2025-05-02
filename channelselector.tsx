import { React, useState, useEffect } from "@webpack/common";
import { findStoreLazy } from "@webpack";
import { ErrorBoundary, Forms, Search, Text } from "@components";

// Load required Discord stores
const ChannelStore = findStoreLazy("ChannelStore");
const GuildStore = findStoreLazy("GuildStore");
const UserStore = findStoreLazy("UserStore");

interface ChannelSelectorProps {
    selectedChannels: string[];
    onChange: (channels: string[]) => void;
}

export default function ChannelSelector({ selectedChannels, onChange }: ChannelSelectorProps) {
    const [searchQuery, setSearchQuery] = useState("");
    const [expandedGuilds, setExpandedGuilds] = useState<Record<string, boolean>>({});
    
    // Get all available channels (DMs and guild channels)
    const getAllChannels = () => {
        const channels = ChannelStore.getGuildChannels ? 
            Object.values(ChannelStore.getGuildChannels()) : 
            Object.values(ChannelStore.getAllChannels());
            
        return channels.filter((channel: any) => {
            // Only include text channels, DMs, and voice channels with text
            return (channel.type === 0 || channel.type === 1 || channel.type === 3);
        });
    };
    
    // Organize channels by guild
    const organizeChannelsByGuild = () => {
        const channelsByGuild: Record<string, any[]> = {};
        const dmChannels: any[] = [];
        
        getAllChannels().forEach((channel: any) => {
            if (channel.type === 1) { // DM
                dmChannels.push(channel);
            } else if (channel.guild_id) {
                if (!channelsByGuild[channel.guild_id]) {
                    channelsByGuild[channel.guild_id] = [];
                }
                channelsByGuild[channel.guild_id].push(channel);
            }
        });
        
        return { channelsByGuild, dmChannels };
    };
    
    // Toggle channel selection
    const toggle
