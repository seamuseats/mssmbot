import { AutocompleteInteraction, CacheType, ChatInputCommandInteraction, SlashCommandBuilder, TextChannel } from "discord.js";
import MSSM from "../bot.js";
import Command from "../command.js";

export default class PlayCommand extends Command {
    public getName() { return "play"; }

    public create() {
        return new SlashCommandBuilder()
            .setName(this.getName())
            .setDescription("Gaming")
            .addStringOption(opt => opt
                .setName("game")
                .setDescription("Game")
                .setAutocomplete(true)
                .setRequired(true)
            )
            .addBooleanOption(opt => opt
                .setName("quiet")
                .setDescription("Does not ping when the game starts. Default false")
                .setRequired(false)
            );
    }

    public async execute(msg: ChatInputCommandInteraction<CacheType>, bot: MSSM) {
        const name = msg.options.getString("game");

        if (!(name in bot.games)) {
            msg.reply({ content: "Unknown game", ephemeral: true });
            return;
        }

        if (bot.isUserPlaying(msg.user)) {
            msg.reply({ content: "You are already in a game. Leave that one first.", ephemeral: true });
            return;
        }

        await msg.reply("Starting...");

        var quiet = msg.options.getBoolean("quiet", false);

        bot.activeGames.push(new bot.games[name](bot.getUser(msg), msg.channel as TextChannel, bot, name, quiet == null ? false : quiet));
    }

    public async autocomplete(cmd: AutocompleteInteraction<CacheType>, bot: MSSM): Promise<void> {
        const focusedValue = cmd.options.getFocused();
        const choices = Object.keys(bot.games);
        const filtered = choices.filter(choice => choice.startsWith(focusedValue));

        await cmd.respond(
            filtered.map(choice => ({ name: choice, value: choice })),
        );
    }
}
