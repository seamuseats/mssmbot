import { ClubData } from "@prisma/client";
import DataMapper from "./mapper.js";
import MSSM from "../bot.js";
import MSSMUser from "./user.js";

export default class Club extends DataMapper<ClubData> implements ClubData {
    public manager: MSSMUser;
    public officers: MSSMUser[] = [];

    public constructor(bot: MSSM, data: ClubData) {
        super(bot, data, bot.clubs.clubData);
    }

    public async refresh() {
        this.manager = this.bot.getUserV2(this.obj.managerId);
        this.fetchArrayFactory(
            this.officers,
            (await this.bot.db.clubData.findUnique({ where: { id: this.obj.id }, include: { officers: true } })).officers,
            MSSMUser
        );
    }

    protected set<TKey extends keyof ClubData>(name: TKey, value: ClubData[TKey]): void {
        (async () => {
            this.obj = await this.bot.db.clubData.update({ where: { id: this.obj.id }, data: { [name]: value } });
        })();
    }

    id: number;
    name: string;
    desc: string;
    infomsg: string;
    channel: string;
    role: string;
    managerId: string;
    meetingTime: string;
    meetingLocation: string;
}