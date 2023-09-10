import { APIEmbed, Awaitable, ComponentType, EmbedBuilder, GuildMember, Message, MessageReaction, ReactionCollector, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, TextChannel, User, roleMention } from "discord.js";
import Component from "../lib/component.js";
import { Poll, Question, QueueDataStorage, Storage } from "../lib/storage.js";
import { createCustomId, quickActionRow, shorten } from "../lib/utils.js";
import { MegaPoll, MegaPollOption, PollData, UserData } from "@prisma/client";
import QOTDCommand from "../commands/qotd.js";
import QOTDSendCommand from "../commands/qotd_send.js";
import ClosePollCommand from "../commands/close_poll.js";
import QOTDQueueCommand from "../commands/qotd_queue.js";
import MegaPollCommand from "../commands/mega_poll.js";
import MetaQuestionsCommand from "../commands/meta_questions.js";

export default class QOTD extends Component {
    public qotdChannel: TextChannel;
    public metaQuestionsChannel: TextChannel;

    public pollEmojiList = ["🔴", "🔵", "🟣", "🟢", "🟡", "🟠", "🟤", "⚪", "⚫"];
    public questionQueue = Storage.make<QueueDataStorage>("queue.json", { queue: [] });

    public async init() {
        this.bot.registerCommand(new QOTDCommand());
        this.bot.registerCommand(new QOTDSendCommand());
        this.bot.registerCommand(new ClosePollCommand());
        this.bot.registerCommand(new QOTDQueueCommand());
        this.bot.registerCommand(new MegaPollCommand());
        this.bot.registerCommand(new MetaQuestionsCommand());

        this.qotdChannel = this.bot.getChannel("942269186061774870");
        this.metaQuestionsChannel = this.bot.getChannel("1139634512230367335");

        if (this.bot.memory.metaid === "") {
            this.log.info("Sending meta question message");
            this.bot.memory.metaid = (await this.metaQuestionsChannel.send("Nothing here right now. Check back later.")).id;
            this.bot.memory.save();
        }

        this.refreshMetaMessage();

        for (const i of await this.bot.db.questionData.findMany({ where: { asked: true, date: null } })) {
            await this.bot.db.questionData.update({ where: { id: i.id }, data: { date: (await this.qotdChannel.messages.fetch(i.link)).createdAt } });
            this.log.info("Fixed question: " + i.question);
        }

        for (const i of await this.bot.db.pollData.findMany({ where: { asked: true, date: null } })) {
            await this.bot.db.pollData.update({ where: { id: i.id }, data: { date: (await this.qotdChannel.messages.fetch(i.link)).createdAt } });
            this.log.info("Fixed poll: " + i.title);
        }

        const activePolls = await this.bot.db.pollData.findMany({ where: { asked: true, open: true } });

        for (const i of activePolls) {
            this.log.info("Connecting to active poll: " + i.title);
            const msg = await this.bot.getChannel(i.channel).messages.fetch(i.link);
            await this.handlePoll(msg);

            if (i.channel === "1139634512230367335") {
                this.log.info("Poll is a meta poll");
                this.scheduleMetaPoll(i);
            }
        }

        for (const i of await this.bot.db.megaPoll.findMany({ where: { open: true }, include: { options: { include: { selected: true } } } })) {
            this.handleMegaPoll(i);
            this.log.info("Connecting to mega poll: " + i.title);
        }

        this.scheduleQotd();
    }

    public async refreshMetaMessage() {
        this.log.debug("Refresing meta message");

        const questions = await this.bot.db.metaQuestion.findMany({ where: { active: true } });
        const polls = await this.bot.db.pollData.findMany({ where: { open: true, channel: "1139634512230367335" } });
        const posts = [...questions, ...polls];

        if (posts.length == 0) {
            await (await this.metaQuestionsChannel.messages.fetch(this.bot.memory.metaid)).edit("Nothing here right now. Check back later.");
        } else if (posts.length == 1) {
            await (await this.metaQuestionsChannel.messages.fetch(this.bot.memory.metaid)).edit(`There is ${posts.length} active post here.`);
        } else {
            await (await this.metaQuestionsChannel.messages.fetch(this.bot.memory.metaid)).edit(`There are ${posts.length} active posts here.`);
        }
    }

    public scheduleQotd() {
        var next = new Date(Date.now());
        if (next.getHours() >= 12) {
            next.setDate(next.getDate() + 1);
        }
        next.setHours(12, 0, 0, 0);

        setTimeout(async () => {
            const activePolls = await this.bot.db.pollData.findMany({ where: { asked: true, open: true, channel: "942269186061774870" } });
            for (const i of activePolls) {
                await this.closePoll(i.id);
            }

            await this.qotdSend();
            this.scheduleQotd();
        }, Math.max(next.getTime() - Date.now(), 1));
    }

    public async qotdSend() {
        const thing = this.questionQueue.queue.shift();
        this.questionQueue.save();

        this.log.info("Sending qotd");

        if (thing !== undefined) {
            var msg: Message;
            var threadTitle = "";
            var author: GuildMember;

            if (thing.type == "question") {
                const question = thing as Question;
                const data = await this.bot.db.questionData.findUnique({ where: { id: question.id } });
                author = this.bot.getUser(data.authorId);

                var embed: EmbedBuilder;
                if (data.isEmbed) {
                    embed = EmbedBuilder.from(question.question as APIEmbed);
                    threadTitle = (question.question as APIEmbed).title
                } else {
                    embed = new EmbedBuilder()
                        .setTitle(question.question as string)
                        .setFooter({ text: "Id: " + question.id })
                        .setAuthor({ name: author.displayName, iconURL: author.displayAvatarURL() });
                    threadTitle = question.question as string;
                }

                msg = await this.qotdChannel.send({ content: "<@&942269442514092082>", embeds: [embed] });

                await this.bot.db.questionData.update({ where: { id: question.id }, data: { asked: true, link: msg.id, date: new Date(Date.now()) } });
            } else if (thing.type == "poll") {
                const poll = thing as Poll;
                author = this.bot.getUser((await this.bot.db.pollData.findUnique({ where: { id: poll.id } })).authorId);
                threadTitle = poll.title;
                msg = await this.sendBasicPoll(poll, this.qotdChannel, "<@&942269442514092082>", author);
            }

            threadTitle = shorten(threadTitle);
            const thread = await msg.startThread({
                name: threadTitle,
                autoArchiveDuration: 1440,
                reason: `Discussion for "${threadTitle}" by ${author.displayName}`
            });

            // for (const i of thread.guild.roles.cache.get("942269442514092082").members.values()) {
            //     thread.members.add(i);
            // }
        } else {
            await this.qotdChannel.send("No questions :skull:\n(pls `/qotd ask`)");
        }
    }

    public async sendBasicPoll(poll: Poll, channel: TextChannel, content: string, author: GuildMember | null = null) {
        var embed = new EmbedBuilder()
            .setTitle(poll.title)
            .addFields(poll.options.map((i, idex) => { return { name: this.pollEmojiList[idex] + ": " + i, value: " " }; }))
            .setFooter({ text: "Id: " + poll.id });

        if (author !== null) {
            embed = embed.setAuthor({ name: author.displayName, iconURL: author.displayAvatarURL() });
        }

        var msg = await channel.send({ content: content, embeds: [embed] });

        for (let i = 0; i < poll.options.length; i++) {
            await msg.react(this.pollEmojiList[i]);
        }

        await this.handlePoll(msg);

        await this.bot.db.pollData.update({ where: { id: poll.id }, data: { asked: true, link: msg.id, date: new Date(Date.now()) } });

        return msg;
    }

    public scheduleMetaPoll(data: PollData) {
        var close = data.date;
        close.setDate(close.getDate() + 1);

        setTimeout(async () => {
            if (!(await this.bot.db.pollData.findUnique({ where: { id: data.id } })).open) return;

            this.log.info("Closing meta poll");
            await this.closePoll(data.id, false);
            await (await this.bot.getChannel(data.channel).messages.fetch(data.link)).thread.send(`${roleMention("1139635551406931990")} poll results have been released.`);
        }, Math.max(close.getTime() - Date.now(), 1));
    }

    private async handlePoll(msg: Message) {
        const collector = msg.createReactionCollector({
            filter: async (reaction, user) => {
                return await this.handlePollReaction(collector, reaction, user);
            }, time: 8.64e+7
        });

        for (const i of msg.reactions.cache.values()) {
            for (const e of (await i.users.fetch()).values()) {
                if (!e.bot) {
                    await this.handlePollReaction(collector, i, e);
                }
            }
        }

        return collector;
    }

    private async handlePollReaction(collector: ReactionCollector, reaction: MessageReaction, user: User) {
        if (user.bot) return false;

        reaction.users.remove(user);

        const poll = await this.bot.db.pollData.findFirst({ where: { link: reaction.message.id }, include: { options: { include: { selected: true } } } });

        if (!poll.open) {
            collector.stop();
            return false;
        }

        const index = this.pollEmojiList.findIndex(i => i == reaction.emoji.name);

        var firstReaction = true;
        for (const i of poll.options) {
            const userIndex = i.selected.findIndex(e => e.id == user.id);
            if (userIndex != -1) {
                await this.bot.db.pollQuestionData.update({ where: { id: i.id }, data: { selected: { disconnect: { id: user.id } } } });
                firstReaction = false;
            }
        }

        if (firstReaction) {
            this.bot.addXP(user.id, 3);
            this.bot.counting.giveSave(user.id, .25);
        }

        await this.bot.db.pollQuestionData.update({ where: { id: poll.options[index].id }, data: { selected: { connect: { id: user.id } } } });

        return true;
    }

    public async closePoll(id: number, addAuthor: boolean = true) {
        const poll = await this.bot.db.pollData.findUnique({ where: { id: id }, include: { options: { include: { selected: true } } } });
        const author = this.bot.getUser((await this.bot.db.pollData.findUnique({ where: { id: poll.id } })).authorId);

        const channel = this.qotdChannel.guild.channels.cache.get(poll.channel) as TextChannel;
        const msg = channel.messages.cache.get(poll.link);
        msg.reactions.removeAll();

        this.log.info("Closing poll: " + poll.title);

        var score: number[] = [];

        for (let idex = 0; idex < poll.options.length; idex++) {
            const i = poll.options[idex];
            score.push(0);

            for (const _ of i.selected) {
                score[idex]++;
            }
        }

        const embed = new EmbedBuilder()
            .setTitle(poll.title)
            .setDescription("Results:")
            .addFields(poll.options.map((i, idex) => {
                return { name: (i.option + ":"), value: "█".repeat(score[idex]) + " " + score[idex] };
            }))
            .setFooter({ text: "Id: " + poll.id });

        if (addAuthor) embed.setAuthor({ name: author.displayName, iconURL: author.displayAvatarURL() });

        var res: Message;
        if (channel.id === "1139634512230367335") {
            res = await (await channel.messages.fetch(poll.link)).edit({ embeds: [embed] });
        } else {
            res = await channel.send({ embeds: [embed] });
        }

        await this.bot.db.pollData.update({ where: { id: id }, data: { open: false, results_link: res.id } });

        return res;
    }

    public async handleMegaPoll(poll: MegaPoll & { options: (MegaPollOption & { selected: UserData[] })[] }) {
        const msg = await this.bot.getChannel(poll.channel).messages.fetch(poll.link);

        const collector = msg.createMessageComponentCollector({ componentType: ComponentType.Button, filter: i => i.customId === poll.buttonId });

        collector.on("collect", async int => {
            const selectorId = createCustomId();

            const createSelector = () => new StringSelectMenuBuilder()
                .setCustomId(selectorId)
                .setMaxValues(poll.options.length)
                .addOptions(...poll.options.map((i, idex) => new StringSelectMenuOptionBuilder().setValue(idex.toString()).setLabel(shorten(i.option)).setDefault(i.selected.findIndex(i => i.id === int.user.id) != -1)));

            const msg = await int.reply({ ephemeral: true, content: "Vote", components: [quickActionRow(createSelector())] });

            const selcollector = msg.createMessageComponentCollector({ filter: i => i.customId === selectorId });

            selcollector.on("collect", async opt => {
                if (opt.isStringSelectMenu()) {
                    const voted = opt.values.map(i => poll.options[parseInt(i)]);

                    for (const i of poll.options) {
                        if (i.selected.findIndex(i => i.id === int.user.id) != -1) {
                            await this.bot.db.megaPollOption.update({ where: { id: i.id }, data: { selected: { disconnect: { id: int.user.id } } } });
                        }
                    }

                    for (const i of voted) {
                        await this.bot.db.megaPollOption.update({ where: { id: i.id }, data: { selected: { connect: { id: int.user.id } } } });
                    }

                    poll.options = await this.bot.db.megaPollOption.findMany({ where: { pollId: poll.id }, include: { selected: true } });
                }

                opt.update({ content: "Vote counted. You can change your vote anytime.", components: [quickActionRow(createSelector())] });
            });
        });
    }
}