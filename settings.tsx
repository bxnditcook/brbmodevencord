import { webpack } from "@webpack";
import { Forms, FormItem, ErrorBoundary } from "@components";
import { React, useState, useEffect } from "@webpack/common";
import ChannelSelector from "./ChannelSelector";

interface SettingsProps {
    settings: {
        isActive: boolean;
        customStatusText: string;
        unmutedChannels: string[];
        digestFormat: "short" | "detailed";
        savePreviousStatus: boolean;
        showDigestOnReturn: boolean;
    };
    onUpdate: (newSettings: Partial<SettingsProps["settings"]>) => void;
    onToggleBRB: () => void;
}

export default function Settings({ settings, onUpdate, onToggleBRB }: SettingsProps) {
    const [statusText, setStatusText] = useState(settings.customStatusText);
    const Switch = webpack.getByProps("Switch").Switch;
    
    useEffect(() => {
        setStatusText(settings.customStatusText);
    }, [settings.customStatusText]);

    // Update status text with debounce
    useEffect(() => {
        const timer = setTimeout(() => {
            if (statusText !== settings.customStatusText) {
                onUpdate({ customStatusText: statusText });
            }
        }, 500);
        
        return () => clearTimeout(timer);
    }, [statusText]);

    return (
        <ErrorBoundary>
            <Forms.FormSection title="Be Right Back Mode Settings">
                <FormItem
                    title="BRB Status"
                    note="Current status: " + (settings.isActive ? "Active (Away)" : "Inactive")
                >
                    <Forms.FormButton
                        onClick={onToggleBRB}
                        color={settings.isActive ? "red" : "green"}
                        disabled={false}
                    >
                        {settings.isActive ? "Deactivate BRB Mode" : "Activate BRB Mode"}
                    </Forms.FormButton>
                </FormItem>

                <FormItem
                    title="Custom Status Text"
                    note="Custom status message to display when you're away"
                >
                    <Forms.FormInput
                        value={statusText}
                        onChange={setStatusText}
                        placeholder="AFK, be right back..."
                    />
                </FormItem>

                <FormItem
                    title="Keep Specific Channels Unmuted"
                    note="Select channels that will stay unmuted while you're away"
                >
                    <ChannelSelector
                        selectedChannels={settings.unmutedChannels}
                        onChange={(channels) => onUpdate({ unmutedChannels: channels })}
                    />
                </FormItem>

                <FormItem
                    title="Digest Format"
                    note="Choose how detailed your message digest will be when you return"
                >
                    <Forms.FormDivider />
                    <Forms.FormTitle>Digest Format Options</Forms.FormTitle>
                    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                        <Forms.FormRadioGroup
                            value={settings.digestFormat}
                            onChange={(value) => onUpdate({ digestFormat: value })}
                            options={[
                                { name: "Short Summary", value: "short" },
                                { name: "Detailed Digest", value: "detailed" }
                            ]}
                        />
                    </div>
                </FormItem>

                <FormItem>
                    <Switch
                        checked={settings.savePreviousStatus}
                        onChange={(checked) => onUpdate({ savePreviousStatus: checked })}
                        note="Remember and restore your previous status"
                    >
                        Save Previous Status
                    </Switch>
                </FormItem>

                <FormItem>
                    <Switch
                        checked={settings.showDigestOnReturn}
                        onChange={(checked) => onUpdate({ showDigestOnReturn: checked })}
                        note="Show message digest automatically when you return"
                    >
                        Show Digest On Return
                    </Switch>
                </FormItem>
            </Forms.FormSection>
        </ErrorBoundary>
    );
}
