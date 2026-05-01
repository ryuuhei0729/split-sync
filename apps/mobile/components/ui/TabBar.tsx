import { type ReactNode } from "react";
import { View, StyleSheet, Pressable, Text } from "react-native";
import { colors, spacing, fontSize } from "../../lib/theme";

interface Tab {
  key: string;
  label: string;
  icon: (props: { color: string; size: number }) => ReactNode;
  disabled?: boolean;
}

interface Props {
  tabs: Tab[];
  activeKey: string;
  onSelect: (key: string) => void;
  onDisabledPress?: (key: string) => void;
}

export function TabBar({ tabs, activeKey, onSelect, onDisabledPress }: Props) {
  return (
    <View style={styles.container}>
      {tabs.map((tab) => {
        const active = tab.key === activeKey;
        const disabled = tab.disabled === true;
        const color = disabled ? colors.muted : active ? colors.primary : colors.muted;
        return (
          <Pressable
            key={tab.key}
            style={[styles.tab, active && styles.tabActive, disabled && styles.tabDisabled]}
            onPress={() => {
              if (disabled) {
                onDisabledPress?.(tab.key);
                return;
              }
              onSelect(tab.key);
            }}
          >
            {tab.icon({ color, size: 16 })}
            <Text style={[styles.tabLabel, { color }]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingVertical: spacing.md,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabActive: {
    borderBottomColor: colors.primary,
  },
  tabDisabled: {
    opacity: 0.4,
  },
  tabLabel: {
    fontSize: fontSize.xs,
    fontWeight: "600",
  },
});
