using BankerGameWeb.Models;

namespace BankerGameWeb.Services
{
    public class GameService
    {
        private readonly Random _random = new();
        private readonly CsvDataService _csvService;
        private List<Mallet> _mallets = new();
        private List<Prize> _prizes = new();
        private List<(Prize Prize, int EliminationOrder, string? SpecialGiftName)> _giftsData = new();
        private List<SpecialGift> _specialGifts = new();
        private List<(BankerOffer Offer, int CumulativeTrigger)> _bankerOffers = new();
        private List<Prize> _unassignedPrizes = new();
        private int _currentRound = 0;
        private int _totalMalletsOpened = 0;
        private int _nextOfferIndex = 0;
        private List<Mallet> _playerMallets = new();
        private int _playerMalletsSelected = 0;
        private readonly int[] _malletsToOpenPerRound = { 6, 5, 4, 3, 2, 1, 1, 1, 1 };
        private List<SpecialGift> _wonSpecialGifts = new();

        public GameService(CsvDataService csvService)
        {
            _csvService = csvService;
        }

        public async Task InitializeAsync()
        {
            _giftsData = await _csvService.LoadGiftsAsync();
            _specialGifts = await _csvService.LoadSpecialGiftsAsync();
            
            // Hardcoded banker offers with cumulative elimination triggers
            _bankerOffers = new List<(BankerOffer Offer, int CumulativeTrigger)>
            {
                (new BankerOffer { Amount = 50, Message = "Carte Cadeau d'essence de 50$" }, 6),
                (new BankerOffer { Amount = 170, Message = "Massage professionnel de 2h" }, 9),
                (new BankerOffer { Amount = 250, Message = "Série de 4 cours de Poterie" }, 11),
                (new BankerOffer { Amount = 100, Message = "Un toutou de Univers Toutou" }, 13),
                (new BankerOffer { Amount = 75, Message = "Hoodie Nike" }, 14),
                (new BankerOffer { Amount = 100, Message = "Un atelier de massage en couple" }, 15),
                (new BankerOffer { Amount = 100, Message = "Un Steamer" }, 16),
                (new BankerOffer { Amount = 150, Message = "Un bijou de MIA" }, 16)
            };
            
            // Initialize prizes from CSV data
            _prizes = _giftsData.Select(x => x.Prize).ToList();
            AssignColors();
        }

        private void AssignColors()
        {
            // Assign gradient colors from blue to magenta based on value
            var sortedPrizes = _prizes.OrderBy(p => p.Value).ToList();
            for (int i = 0; i < sortedPrizes.Count; i++)
            {
                var ratio = (float)i / (sortedPrizes.Count - 1);
                // Blue (#4A90E2) to Magenta (#880E4F)
                var r = (byte)(74 + (136 - 74) * ratio);
                var g = (byte)(144 - (144 - 14) * ratio);
                var b = (byte)(226 - (226 - 79) * ratio);
                sortedPrizes[i].Color = $"#{r:X2}{g:X2}{b:X2}";
            }
        }

        public void StartNewGame()
        {
            _currentRound = 0;
            _totalMalletsOpened = 0;
            _nextOfferIndex = 0;
            _playerMallets.Clear();
            _playerMalletsSelected = 0;
            _wonSpecialGifts.Clear();
            _mallets.Clear();
            _unassignedPrizes = new List<Prize>(_prizes);

            for (int i = 1; i <= 20; i++)
            {
                _mallets.Add(new Mallet
                {
                    Number = i,
                    Prize = null,
                    IsOpen = false,
                    IsSelected = false
                });
            }
        }

        private Prize SelectPrizeToEliminate()
        {
            // Get all prizes that have already been assigned (opened mallets + player mallets)
            var assignedPrizeNames = _mallets
                .Where(m => m.Prize != null && (m.IsOpen || _playerMallets.Contains(m)))
                .Select(m => m.Prize!.Name)
                .ToHashSet();

            // Get next prize to eliminate based on elimination order from unassigned prizes only
            var nextToEliminate = _giftsData
                .Where(g => !assignedPrizeNames.Contains(g.Prize.Name) && _unassignedPrizes.Any(p => p.Name == g.Prize.Name))
                .OrderBy(g => g.EliminationOrder)
                .FirstOrDefault();

            if (nextToEliminate.Prize != null)
            {
                var prize = _unassignedPrizes.FirstOrDefault(p => p.Name == nextToEliminate.Prize.Name);
                if (prize != null)
                {
                    Console.WriteLine($"SelectPrizeToEliminate: Selecting prize '{prize.Name}' with elimination order {nextToEliminate.EliminationOrder}");
                    return prize;
                }
            }

            // Fallback: return any unassigned prize
            var fallbackPrize = _unassignedPrizes.FirstOrDefault();
            Console.WriteLine($"SelectPrizeToEliminate: Using fallback prize '{fallbackPrize?.Name}'");
            return fallbackPrize ?? _prizes[0];
        }

        public List<Mallet> GetMallets() => _mallets;

        public List<Prize> GetRemainingPrizes()
        {
            // Get prizes from opened mallets (revealed)
            var revealedPrizes = _mallets
                .Where(m => m.IsOpen && m.Prize != null)
                .Select(m => m.Prize!)
                .ToList();
            
            // Get prizes from player's selected mallets (not revealed)
            var playerPrizes = _playerMallets
                .Where(m => m.Prize != null)
                .Select(m => m.Prize!)
                .ToList();
            
            var allPrizes = new List<Prize>();
            allPrizes.AddRange(revealedPrizes);
            allPrizes.AddRange(playerPrizes);
            allPrizes.AddRange(_unassignedPrizes);
            
            return allPrizes.OrderBy(p => p.Value).ToList();
        }

        public bool SelectPlayerMallet(int malletNumber)
        {
            var mallet = _mallets.FirstOrDefault(m => m.Number == malletNumber);
            if (mallet == null || mallet.IsOpen || mallet.IsSelected) return false;
            if (_playerMalletsSelected >= 3) return false;

            mallet.IsSelected = true;
            _playerMallets.Add(mallet);
            _playerMalletsSelected++;
            
            // Assign a prize with no elimination order (those marked as 1000+ = "never" in CSV)
            var neverEliminatedPrizes = _giftsData
                .Where(g => g.EliminationOrder >= 1000 && _unassignedPrizes.Any(p => p.Name == g.Prize.Name))
                .Select(g => g.Prize)
                .ToList();
            
            if (neverEliminatedPrizes.Any())
            {
                var randomPrize = neverEliminatedPrizes[_random.Next(neverEliminatedPrizes.Count)];
                var prizeToAssign = _unassignedPrizes.First(p => p.Name == randomPrize.Name);
                mallet.Prize = prizeToAssign;
                _unassignedPrizes.Remove(prizeToAssign);
                Console.WriteLine($"SelectPlayerMallet: Assigned prize '{prizeToAssign.Name}' with elimination order 'never' to mallet #{malletNumber}");
            }
            else if (_unassignedPrizes.Any())
            {
                // Fallback if no "never" prizes left
                var randomPrize = _unassignedPrizes[_random.Next(_unassignedPrizes.Count)];
                mallet.Prize = randomPrize;
                _unassignedPrizes.Remove(randomPrize);
            }
            
            return true;
        }

        public bool OpenMallet(int malletNumber)
        {
            var mallet = _mallets.FirstOrDefault(m => m.Number == malletNumber);
            if (mallet == null || mallet.IsOpen || _playerMallets.Contains(mallet)) return false;

            if (_unassignedPrizes.Any())
            {
                var prizeToEliminate = SelectPrizeToEliminate();
                mallet.Prize = prizeToEliminate;
                _unassignedPrizes.Remove(prizeToEliminate);
            }

            mallet.IsOpen = true;
            if (mallet.Prize != null)
            {
                mallet.Prize.IsRevealed = true;
            }
            
            _totalMalletsOpened++;
            Console.WriteLine($"OpenMallet: Mallet #{malletNumber} opened. Total eliminations: {_totalMalletsOpened}");
            
            return true;
        }

        public SpecialGift? GetSpecialGiftForEliminatedPrize(Prize prize)
        {
            // Find elimination order for this prize
            var giftData = _giftsData.FirstOrDefault(g => g.Prize.Name == prize.Name);
            if (giftData.Prize == null) return null;

            // Check if there's a special gift for this elimination order
            var specialGift = _specialGifts.FirstOrDefault(sg => 
                sg.TriggeredByEliminationOrder == giftData.EliminationOrder);

            return specialGift;
        }

        public void AddWonSpecialGift(SpecialGift gift)
        {
            _wonSpecialGifts.Add(gift);
        }

        public List<SpecialGift> GetWonSpecialGifts() => _wonSpecialGifts;

        public int GetMalletsToOpenThisRound()
        {
            if (_currentRound >= _malletsToOpenPerRound.Length)
                return 1;
            return _malletsToOpenPerRound[_currentRound];
        }

        public int GetMalletsOpenedThisRound()
        {
            var totalForPreviousRounds = 0;
            for (int i = 0; i < _currentRound; i++)
            {
                if (i < _malletsToOpenPerRound.Length)
                    totalForPreviousRounds += _malletsToOpenPerRound[i];
            }
            
            return _totalMalletsOpened - totalForPreviousRounds;
        }

        public bool CanMakeOffer()
        {
            // Don't make offers if no mallets can be opened (0 remaining)
            if (GetRemainingMallets().Count == 0)
            {
                Console.WriteLine($"CanMakeOffer: Game over, no mallets remaining");
                return false;
            }
            
            // Check if there's a next offer and if we've reached or passed its cumulative total
            if (_nextOfferIndex < _bankerOffers.Count)
            {
                var nextOffer = _bankerOffers[_nextOfferIndex];
                Console.WriteLine($"CanMakeOffer: Checking offer index {_nextOfferIndex}, needs {nextOffer.CumulativeTrigger} eliminations, have {_totalMalletsOpened}");
                return nextOffer.CumulativeTrigger <= _totalMalletsOpened;
            }
            
            Console.WriteLine($"CanMakeOffer: No more offers available (index {_nextOfferIndex}, total offers {_bankerOffers.Count})");
            return false;
        }

        public BankerOffer? GenerateBankerOffer()
        {
            if (_nextOfferIndex >= _bankerOffers.Count)
            {
                Console.WriteLine($"GenerateBankerOffer: No offers left (index {_nextOfferIndex})");
                return null;
            }

            var offerData = _bankerOffers[_nextOfferIndex];
            Console.WriteLine($"GenerateBankerOffer: Returning offer {_nextOfferIndex + 1} (trigger at {offerData.CumulativeTrigger})");
            _nextOfferIndex++;
            return offerData.Offer;
        }

        public Prize? GetPlayerPrize()
        {
            return _playerMallets.FirstOrDefault()?.Prize;
        }

        public List<Mallet> GetPlayerMallets() => _playerMallets;
        
        public int GetPlayerMalletsSelected() => _playerMalletsSelected;

        public bool IsGameOver()
        {
            var remainingMallets = GetRemainingMallets();
            // Game ends when no mallets left to open and all offers shown
            return remainingMallets.Count == 0 && _nextOfferIndex >= _bankerOffers.Count;
        }

        public Mallet? GetLastRemainingMallet()
        {
            var remainingMallets = GetRemainingMallets();
            return remainingMallets.Count == 1 ? remainingMallets[0] : null;
        }

        public bool ShouldRevealLastMallet()
        {
            // Reveal last mallet when only 1 remains and all offers are complete
            return GetRemainingMallets().Count == 1 && _nextOfferIndex >= _bankerOffers.Count;
        }

        public bool HasOneMalletLeft()
        {
            return GetRemainingMallets().Count == 1;
        }

        public int GetCurrentRound() => _currentRound;

        public List<Mallet> GetRemainingMallets()
        {
            return _mallets.Where(m => !m.IsOpen && !_playerMallets.Contains(m)).ToList();
        }

        public int GetTotalMalletsOpened() => _totalMalletsOpened;
    }
}
