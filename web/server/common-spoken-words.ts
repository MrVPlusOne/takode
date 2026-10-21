/**
 * The most common words of spoken English, with their inflected forms: every word form of the
 * NGSL-Spoken 1.2 list (721 headwords that cover about 90% of unscripted spoken English, from
 * the Cambridge English Corpus of spoken English). A speech recognizer already knows these words, so
 * they are never worth sending as transcription keywords.
 *
 * Source: NGSL-Spoken 1.2 (lemmatized for research), Charles Browne and Brent Culligan, 2017,
 * https://www.newgeneralservicelist.com/ngsl-spoken. Licensed under Creative Commons
 * Attribution-ShareAlike 4.0 International (https://creativecommons.org/licenses/by-sa/4.0/).
 * This file is an adaptation of that list (lowercased, forms merged into one set, non-alphabetic
 * forms dropped) and is shared under the same licence; the rest of Takode keeps its own licence.
 */
export const COMMON_SPOKEN_WORDS: ReadonlySet<string> = new Set(
  `
a able abled ables ablest abling ablings about absolutely accept accepted accepting acceptings account
accounted accounting accountings across action actioned actioning actionings actually add added adding addings
address addressed addressing addressings affect affected affecting affectings after afternoon again against
age aged ageing ageings aging ago agree agreed agreeing agreeings ahead ain air aired airing airings all allow
allowed allowing allowings almost along already alright also although always amount amounted amounting
amountings and anded anding another answer answered answering answerings any anybody anyone anything anyway
applied apply applying applyings are area aren around as ask asked asking askings at ate available aware away
awful babied baby babying babys back backed backing backings bad badder baddest bag bagged bagging baggings
base based baser basest basically basing be bear beared bearing bearings became because become becomeing
becomeings becoming bed bedded bedding beddings been before began begin beginned beginning beginnings begun
behind bein being beings believe believed believing believings benefit benefited benefiting benefitted
benefitting benefittings best bet betted better betting bettings between big biggest bill billed billing
billings bit bitted bitting bittings black blacked blacker blackest blacking bloodied bloodier bloodiest
bloody bloodying board boarded boarding boardings bodied body bodying bodys book booked booking bookings borne
both bother bothered bothering botherings bottom bottomed bottoming bottomings bought box boxed boxing boxings
boy break breaking breath brief briefed briefer briefest briefing briefings bring bringing bringings broke
broken brother brought budget budgeted budgeting budgetings build builded building buildings built bus bused
business busing busings but buy buyed buying by call called calling callings came can canned canning cannings
cannot car card carded carding cardings care cared caring carings carried carry carryed carrying carrys case
cased casing casings catch catched catching caught cause caused causing causings center centered centering
centerings centre centred centres centring centrings certain certainly chance chanced chancing chancings
change changed changing changings charge charged charging chargings cheap cheapest check checked checking
checkings child children childrens choice choicer choicest choose choosed choosing chose chosen church
churched churching churchs city citys class classed classing classings clean cleaned cleaning cleanings clear
cleared clearer clearest clearing clearings clock clocked clocking clockings close closed closer closest
closing closings cold coldest colds college color colored coloring colorings colour coloured colouring
colourings colours come comed comeing cometh comin coming comings comment commented commenting commentings
committee community company companys completely computer concern concerned concerning concernings consider
considered considering considerings contact contacted contacting contactings continue continued continueing
continueings continuing control controlled controlling controllings conversation cool cooled coolest cooling
copied copy copying copyings correct corrected correcting correctings cost costed costing costings cough
coughed coughing coughings could coulda council councilled councilling councillings country countrys couple
coupled coupling couplings course coursed coursing coursings cover covered covering coverings coz create
created creating creatings cut cutted cutting cuttings d dad daddies daddy daies date dated dating datings day
deal dealed dealing dealings dealt dear dearer dearest decide decided deciding decidings decision definitely
degree depend depended depending dependings detail detailed detailing detailings develop developed developing
developings development did didn die died dieing dieings difference differenced differencing differencings
different difficult dinner discuss discussed discussing discussings discussion do doctor doctored doctoring
document documented documenting documentings doesn dog dogged dogging doggings doin doing doings dollar done
door down downed downing downings dr drank draw drawed drawing drawings drawn drew drink drinking drinkings
drive drived driven driving drop dropped dropping droppings drove droves during dying each earliest early
easiest easy eat eaten eating education effect effected effecting effectings effort eight eighth eighths
eighties eightieth eightieths eights eighty eightys either eleven elevens eleventh elevenths else em end ended
ending endings enjoy enjoyed enjoying enjoyings enough especially even evened evening ever every everybody
everyone everything exactly example expect expected expecting expectings experience experienced experiencing
experiencings explain explained explaining explainings extra eye eyed eyeing eyeings face faced facing facings
fact fair faired fairer fairest fairing fairly fall falled fallen falling family familys far farthest father
fathered fathering fatherings feel feeled feeling feelings feet fell felt few fewers fewest fewests fifteen
fifteens fifteenth fifteenths fifth fifths fifties fiftieth fiftieths fifty fiftys figure figured figuring
figurings fill filled filling fillings find finded finding findings fine fined finer finest fining finish
finished finishing finishings fire fired firing firings first fit fitted fitter fittest fitting fittings five
fives floor floored flooring floorings focus focused focusing focuss focussed focusses focussing focussings
follow followed following followings food foot footed footing footings for force forced forcing forcings
foreward forewarded forewarding forewardings forewards forget forgetting forgot forgotten form formed forming
formings forties fortieth fortieths forty fortys forward forwarded forwarding found four fours fourth fourths
free freed freeing freer freest friend from front fronted fronting frontings full fulled fuller fullest
fulling fun fund funded funding fundings funniest funny further furthered furtherest furthering furtherings
futherer future game gamed gaming gamings gave general get gettin getting girl give gived giveing given giveth
giving go goin going goings gone gonna good got gotta gotten government govt grade graded grading gradings
great greatest greats grew group grouped grouping groupings grow growed growing grown guess guessed guessing
guessings gunna guy guyed guying guyings had hadn hafta hair haired half halfed halfing halfings halfs halved
halving halvings hand handed handing handings hang hanged hanging hangings happen happened happening
happenings happiest happy hard hardest has hasn hate hated hating hatings have haves having havings he head
headed heading headings health hear heard hearing hearings held help helped helping helpings here hers high
highest highs his hit hitted hitting hittings hold holded holding holdings holiday holidayed holidaying
holidayings home homed homing homings hope hoped hoping hopings hospital hot hotted hotter hottest hotting
hour house housed housing housings how hundred hundreds hundredth hundredths hung husband husbanded husbanding
husbandings i idea if imagine imagined imagining imaginings important in include included including includings
increase increased increasing increasings individual information instead interest interested interesting
interestings into involve involved involving involvings is isn issue issued issuing issuings it item itself
job jobbing jobbings just keep keeped keeping kept kid kidded kidding kiddings kill killed killing killings
kind kinda kinder kindest knew know knowed knowin knowing knowings known lady ladys land landed landing
landings language large largest last lasted lasting lastings late latest laugh laughed laughing laughings
laughter law lawed lawing lawings lead leaded leading learn learned learning learnings learnt least leave
leaved leaving leavings led lemme less let letted letter lettered lettering letterings letting lettings level
leveled leveling levelled levelling levellings life light lighted lightest lighting like liked liking likings
line lined lining linings list listed listen listened listening listenings listing listings lit little
littlest live lived living livings ll load loaded loading loadings local long longed longer longest longing
longings look looked lookin looking lose losing losings lost lot lotta love loved loveliest lovely loving
lovings low lowed lower lowered lowering lowerings lowers lowest lowing m machine machined machining
machinings made main major majored majoring majorings make maked makeing makeings maketh making makings man
manned manning many market marketed marketing marketings married marry marryed marrying math mathematics maths
matter mattered mattering matterings may maybe mays mean meaned meaner meanest meaning meanings meant meet
meeted meeting meetings member membered membering memberings men mens mention mentioned mentioning mentionings
met middle middled middling middlings might mighta mile million millions millionth millionths mind minded
minding mindings mine mined mining minute minuted minuting minutings miss missed missing missings moment money
moneyed monied month more mornin morning most mother mothered mothering motherings move moved movie moving
movings much music must musta my myself name named naming namings national near neared nearer nearest nearing
need needed needing needn never new newest news next nice nicest night nine nines nineteen nineteens
nineteenth nineteenths nineties ninetieth ninetieths ninety ninetys ninth ninths nite nites no nobodies nobody
noise normally not note noted nothing notice noticed noticing noticings noting notings nots now number
numbered numbering numberings obviously of off offed offer offered offering offerings offerred offerring
office offing offings often ok okay okayed okaying old oldest olds on once one only open opened opening
openings opportunity or order ordered ordering orderings other ought oughta our ours out outed outing outings
outside outta over own owned owning ownings page paged paging pagings paid paper papered papering paperings
parent parented parenting parentings park parked parking parkings part parted particular particularly partied
parting partings party partying partys pass passed passing passings past pause paused pausing pausings pay
payed paying payings people peopled peopling peoplings per percent perhaps period person phone phoned phoning
phonings pick picked picking pickings picture pictured picturing picturings piece pieced piecing piecings
place placed placing placings plan planned planning plannings play played playing playings please pleased
pleasing pleasings plus point pointed pointing pointings police policed policing policings policy position
positioned positioning positionings possible pound pounded pounding poundings power powered powering powerings
present presented presenting presentings press pressed pressing pressings prettier prettiest pretty prettyed
prettying price priced pricing pricings probably problem process processed processing processings produce
produced producing producings product program programed programing programme programmed programmes programming
programmings project projected projecting projectings provide provided providing providings public pull pulled
pulling pullings purpose purposed purposing purposings push pushed pushing pushings put putted putting
puttings quality question questioned questioning questionings quick quickest quite raise raised raising
raisings ran rang rate rated rather rating ratings re read readed readied readier readiest reading readings
ready readyed readying readyings real realise realised realises realising realisings realize realized
realizing really reason reasoned reasoning reasonings receive received receiving receivings record recorded
recording recordings red redded redder reddest redding relate related relating relatings relationship remember
remembered remembering rememberings report reported reporting reportings require required requiring requirings
research researched researching researchings response responsed responsing responsings rest rested resting
restings result resulted resulting resultings review reviewed reviewing reviewings right righted righter
rightest righting ring ringed ringing road roaded roading roadings room roomed rooming roomings round rounded
rounder rounders roundest rounding rule ruled ruling rulings run rung runneth runnin running s said sale same
sang sat save saved saving savings saw say sayed sayin saying sayings school schooled schooling schoolings
score scored scoring scorings sec second seconded seconding see seeing seem seemed seeming seemings seen sell
selled selling send sended sending sense sensed sensing sensings sent service serviced servicing servicings
set setted setting settings seven sevens seventh sevenths seventies seventieth seventieths seventy seventys
several shall share shared sharing sharings she shop shopped shopping shoppings short shorted shorter shortest
shorting should shoulda show showed showing showings shown side sided siding sidings sign signed signing
signings since sing singin singing single singled singling singlings sister sit site sited siting sitings
sitting sittings situation six sixs sixth sixths sixties sixtieth sixtieths sixty sixtys size sized sizing
sizings sleep sleeping sleepings slept small smallest smalls so sold some somebody somebodys someone something
somethings sometimes somewhere soon soonest sorriest sorry sort sorted sorting sortings sound sounded sounding
soundings speak speaking special specialled specialling speciallings specific spend spended spending spendings
spent spoke spoken staff staffed staffing staffings stage staged staging stagings stand standard standed
standing standings start started starting startings state stated statement statemented statementing
statementings stating statings stay stayed staying stayings step stepped stepping steppings stick sticked
sticking still stilled stiller stillest stilling stood stop stopped stopping stoppings storey storeys storied
story storys straight straightest straights street strong strongest stuck student studied study studying
studyings stuff stuffed stuffing stuffings subject subjected subjecting subjectings such suggest suggested
suggesting suggestings summer summered summering summerings sung support supported supporting supportings
suppose supposed supposing supposings sure surest surprise surprised surprising surprisings system table
tabled tabling tablings take taken taking takings talk talked talkin talking tape taped taping tapings taught
tax taxed taxing taxings tea teach teacher teaching teachings team teamed teaming teamings tell telled tellin
telling ten tend tended tending tendings tens tenth tenths term termed terming termings test tested testing
testings text texted texting textings than thank thanked thanking thankings that the their theirs them
themselves then there therefore they thing think thinked thinking third thirds thirties thirtieth thirtieths
thirty thirtys this though thought thoughts thousand thousands thousandth thousandths three threes threw
through throw throwed throwing thrown till tilled tilling tillings time timed timing timings to today together
told tomorrow tonight too took top topped topping toppings totally toward town trade traded trading tradings
train trained training trainings travel traveled traveling travelled travellin travelling tried trouble
troubled troubling troublings true trued truer trues truest truing try tryed trying turn turned turning
turnings twelfth twelfths twelve twelves twenties twentieth twentieths twenty twentys two twos type typed
typing typings unclear uncleared under understand understanding understandings understood unless until up
upped upping uppings use used using usings usually value valued valuing valuings various ve very view viewed
viewing viewings visit visited visiting visitings vote voted voting votings wait waited waiting waitings walk
walked walking walkings wanna want wanted wantin wanting war warred warring warrings was wasn watch watched
watching watchings water watered watering waterings way we wear wearing week weekend weekended weekending
weekendings well welled welling wellings went were weren what whatever when where whether which while whiled
whiling white whites whitest who whole whose why wife wifes will willed willing win window windowed windowing
windowings winned winning winnings wish wished wishing wishings with within without woman womans womens won
wonder wondered wonderful wondering wonderings word worded wording wordings wore work worked working workings
world worn worried worry worrying worryings worst worth would write writing writings written wrong wronged
wronger wrongest wronging wrote yeah year yer yerself yerselves yes yesterday yet you young youngest yours
yourself
`
    .trim()
    .split(/\s+/),
);
